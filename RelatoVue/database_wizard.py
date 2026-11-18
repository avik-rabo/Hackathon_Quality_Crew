"""Read-only catalog discovery and table imports for the local setup wizard."""

from contextlib import closing
import re

MAX_ROWS = 10_000
LABELS = {"postgres": "PostgreSQL", "mysql": "MySQL", "oracle": "Oracle Database"}
DRIVERS = {
    "postgres": 'python -m pip install "psycopg[binary]"',
    "mysql": 'python -m pip install "mysql-connector-python>=9.2"',
    "oracle": "python -m pip install oracledb",
}


class SetupError(ValueError):
    """A validation error safe to display to the user."""


def connection_parameters(payload):
    if not isinstance(payload, dict):
        raise SetupError("Enter database connection details.")
    engine = payload.get("engine")
    if not isinstance(engine, str) or engine not in LABELS:
        raise SetupError("Choose a supported database engine.")

    def field(name, limit=255, required=True):
        value = payload.get(name, "")
        if not isinstance(value, str) or len(value) > limit or "\x00" in value:
            raise SetupError(f"Check the {name} field.")
        if required and not value.strip():
            raise SetupError(f"Enter the {name}.")
        return value if name == "password" else value.strip()

    host = field("host")
    if not re.fullmatch(r"[A-Za-z0-9.-]+|[0-9A-Fa-f:]+", host):
        raise SetupError("Enter a hostname or IP address without a URL or port.")
    port = payload.get("port")
    if type(port) is not int or not 1 <= port <= 65535:
        raise SetupError("Enter a port between 1 and 65535.")
    database = field("database", 128)
    user = field("user", 128)
    password = field("password", 4096, required=False)
    ca = field("ca", 1024, required=False)
    return engine, host, port, database, user, password, ca, payload.get("oracleTcp") is True


def connect(payload, configured_connect):
    engine, host, port, database, user, password, ca, oracle_tcp = connection_parameters(payload)
    if engine == "postgres":
        from psycopg.conninfo import make_conninfo

        conninfo = make_conninfo(
            host=host, port=port, dbname=database, user=user, password=password,
            sslmode="verify-full", sslrootcert=ca or "system", gssencmode="disable",
        )
        return configured_connect(engine, {"conninfo": conninfo})
    if engine == "mysql":
        settings = {"host": host, "port": port, "database": database, "user": user, "password": password}
        if ca:
            settings["ssl_ca"] = ca
        return configured_connect(engine, settings)
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", database):
        raise SetupError("Enter the Oracle service name, such as ORCLPDB1.")
    return configured_connect(engine, {
        "host": host, "port": port, "service_name": database, "user": user, "password": password,
        "protocol": "tcp" if oracle_tcp else "tcps", "ssl_server_dn_match": not oracle_tcp,
    })


def identifier(value):
    if not isinstance(value, str) or not value or len(value) > 255 or "\x00" in value:
        raise SetupError("Choose a schema, table, or column from the catalog.")
    return value


def quote(value, engine):
    delimiter = "`" if engine == "mysql" else '"'
    return delimiter + identifier(value).replace(delimiter, delimiter * 2) + delimiter


def catalog(cursor, engine, operation, schema=None, table=None):
    if engine == "oracle":
        if operation == "schemas":
            sql = "SELECT DISTINCT OWNER FROM ALL_CATALOG WHERE TABLE_TYPE IN ('TABLE','VIEW') ORDER BY OWNER FETCH FIRST 500 ROWS ONLY"
            args = ()
        elif operation == "tables":
            sql = """SELECT TABLE_NAME, TABLE_TYPE FROM ALL_CATALOG
                     WHERE OWNER = :1 AND TABLE_TYPE IN ('TABLE','VIEW')
                     ORDER BY TABLE_NAME FETCH FIRST 1000 ROWS ONLY"""
            args = (schema,)
        else:
            sql = """SELECT COLUMN_NAME, DATA_TYPE FROM ALL_TAB_COLUMNS
                     WHERE OWNER = :1 AND TABLE_NAME = :2 ORDER BY COLUMN_ID"""
            args = (schema, table)
    elif operation == "schemas":
        sql = """SELECT DISTINCT table_schema FROM information_schema.tables
                 WHERE table_type IN ('BASE TABLE','VIEW')
                   AND table_schema NOT IN ('information_schema','pg_catalog','mysql','performance_schema','sys')
                   AND table_schema NOT LIKE 'pg_toast%'
                 ORDER BY table_schema LIMIT 500"""
        args = ()
    elif operation == "tables":
        sql = """SELECT table_name, table_type FROM information_schema.tables
                 WHERE table_schema = %s AND table_type IN ('BASE TABLE','VIEW')
                 ORDER BY table_name LIMIT 1000"""
        args = (schema,)
    else:
        sql = """SELECT column_name, data_type FROM information_schema.columns
                 WHERE table_schema = %s AND table_name = %s ORDER BY ordinal_position"""
        args = (schema, table)
    if args:
        cursor.execute(sql, args)
    else:
        cursor.execute(sql)
    return cursor.fetchall()


def run(operation, request, configured_connect, json_value):
    settings = request.get("connection")
    engine = connection_parameters(settings)[0]
    schema = identifier(request.get("schema")) if operation != "schemas" else None
    table = identifier(request.get("table")) if operation in ("columns", "load") else None
    columns = request.get("columns") if operation == "load" else None
    limit = request.get("limit") if operation == "load" else None
    if operation == "load":
        if not isinstance(columns, list) or not 1 <= len(columns) <= 256:
            raise SetupError("Select between 1 and 256 columns.")
        columns = [identifier(column) for column in columns]
        if len(set(columns)) != len(columns):
            raise SetupError("Select each column once.")
        if type(limit) is not int or not 1 <= limit <= MAX_ROWS:
            raise SetupError(f"Choose a row limit between 1 and {MAX_ROWS:,}.")

    with closing(connect(settings, configured_connect)) as connection, closing(connection.cursor()) as cursor:
        if engine == "mysql":
            cursor.execute("START TRANSACTION READ ONLY")
        elif engine == "oracle":
            cursor.execute("SET TRANSACTION READ ONLY")
        if operation == "schemas":
            return {"schemas": [row[0] for row in catalog(cursor, engine, operation)]}
        if operation == "tables":
            return {"tables": [{"name": name, "kind": kind} for name, kind in catalog(cursor, engine, operation, schema)]}
        available = catalog(cursor, engine, "columns", schema, table)
        if operation == "columns":
            return {"columns": [{"name": name, "type": kind} for name, kind in available]}
        if not set(columns).issubset({name for name, _ in available}):
            raise SetupError("The available columns changed. Reload the column list.")
        field_list = ", ".join(quote(column, engine) for column in columns)
        relation = ".".join(quote(item, engine) for item in (schema, table))
        cap = f"FETCH FIRST {limit + 1} ROWS ONLY" if engine == "oracle" else f"LIMIT {limit + 1}"
        cursor.execute(f"SELECT {field_list} FROM {relation} {cap}")
        rows = cursor.fetchmany(limit + 1)
        return {
            "name": f"{schema}.{table}", "source": LABELS[engine], "columns": columns,
            "rows": [[json_value(value) for value in row] for row in rows[:limit]],
            "truncated": len(rows) > limit, "rowLimit": limit,
        }
