"""Account and workspace storage for the loopback RelatoVue server."""

from contextlib import closing
import hashlib
import hmac
from http.cookies import SimpleCookie, CookieError
import json
from pathlib import Path
import re
import secrets
import sqlite3
from threading import BoundedSemaphore
from time import time

STORE = Path(__file__).resolve().parent / ".relatovue" / "workspaces.sqlite3"
COOKIE = "relatovue_session"
TTL = 8 * 3600
HASH_SLOTS = BoundedSemaphore(2)


class WorkspaceError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def connect():
    STORE.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(STORE, timeout=5)
    db.execute("PRAGMA foreign_keys=ON")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE,
            salt BLOB NOT NULL, password BLOB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            digest TEXT PRIMARY KEY, owner INTEGER NOT NULL REFERENCES accounts(id), expires INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS workspaces (
            id INTEGER PRIMARY KEY, owner INTEGER NOT NULL REFERENCES accounts(id),
            name TEXT NOT NULL COLLATE NOCASE, settings TEXT NOT NULL, UNIQUE(owner,name)
        );
    """)
    return db


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def session_digest(header):
    try:
        item = SimpleCookie(header).get(COOKIE)
        if item and re.fullmatch(r"[A-Za-z0-9_-]{43}", item.value):
            return digest(item.value)
    except CookieError:
        pass
    return ""


def session_cookie(token="", age=0):
    return f"{COOKIE}={token}; Path=/; Max-Age={age}; HttpOnly; SameSite=Strict"


def password_hash(password, salt):
    if not HASH_SLOTS.acquire(blocking=False):
        raise WorkspaceError("Sign-in is busy. Try again in a moment.", 429)
    try:
        return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 600_000)
    finally:
        HASH_SLOTS.release()


def clean_settings(value):
    if not isinstance(value, dict):
        raise WorkspaceError("Invalid workspace settings.")
    result = {}
    for key in ("measure", "dimension", "dateField", "profileKey"):
        field = value.get(key)
        if key in value and (field is None or isinstance(field, str) and len(field) <= 255):
            result[key] = field
    outcome_fields = value.get("outcomeFields")
    if isinstance(outcome_fields, dict):
        fields = {}
        for key in ("rule", "ruleKey", "population", "valid", "invalid", "score", "group", "party", "date"):
            field = outcome_fields.get(key)
            if isinstance(field, str) and 0 < len(field) <= 255:
                fields[key] = field
            elif key in ("ruleKey", "score", "group", "party", "date") and key in outcome_fields and field is None:
                fields[key] = None
        if fields:
            result["outcomeFields"] = fields
    for key, choices in {"timeChart": ("line", "bar", "table"), "groupChart": ("bar", "donut", "table")}.items():
        if value.get(key) in choices:
            result[key] = value[key]
    period = value.get("period")
    if period == "all" or isinstance(period, str) and re.fullmatch(r"[1-9][0-9]{0,2}", period):
        result["period"] = period
    freshness = value.get("freshness")
    if isinstance(freshness, dict):
        field, days, as_of = (freshness.get(key) for key in ("field", "days", "asOf"))
        if (isinstance(field, str) and len(field) <= 255 and type(days) is int and 0 <= days <= 36500
                and isinstance(as_of, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", as_of)):
            result["freshness"] = {"field": field, "days": days, "asOf": as_of}
    return result


def handle(operation, payload, cookie):
    session = session_digest(cookie)
    now = int(time())
    # Visiting the start page as a guest need not create a database.
    if operation == "list" and not session:
        return {"user": None, "workspaces": []}, None
    with closing(connect()) as db, db:
        user = db.execute(
            "SELECT a.id,a.username FROM sessions s JOIN accounts a ON a.id=s.owner WHERE s.digest=? AND s.expires>?",
            (session, now),
        ).fetchone() if session else None
        if operation in ("register", "login"):
            name, password = payload.get("username"), payload.get("password")
            if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{3,40}", name):
                raise WorkspaceError("Use a username with 3–40 letters, digits, dots, underscores, or hyphens.")
            if not isinstance(password, str) or not 12 <= len(password) <= 256:
                raise WorkspaceError("Use a password with 12–256 characters.")
            name = name.lower()
            if operation == "register":
                salt = secrets.token_bytes(16)
                hashed = password_hash(password, salt)
                try:
                    owner = db.execute("INSERT INTO accounts(username,salt,password) VALUES (?,?,?)", (name,salt,hashed)).lastrowid
                except sqlite3.IntegrityError:
                    raise WorkspaceError("That username is unavailable.", 409) from None
                db.execute("INSERT INTO workspaces(owner,name,settings) VALUES (?,?,?)", (owner,"Personal","{}"))
            else:
                account = db.execute("SELECT id,salt,password FROM accounts WHERE username=?", (name,)).fetchone()
                hashed = password_hash(password, account[1] if account else bytes(16))
                if not account or not hmac.compare_digest(hashed, account[2]):
                    raise WorkspaceError("Username or password did not match.", 401)
                owner = account[0]
            token = secrets.token_urlsafe(32)
            db.execute("DELETE FROM sessions WHERE expires<=? OR digest=?", (now, session))
            db.execute("INSERT INTO sessions VALUES (?,?,?)", (digest(token),owner,now+TTL))
            return listing(db,owner,name), session_cookie(token,TTL)
        if operation == "logout":
            db.execute("DELETE FROM sessions WHERE digest=?", (session,))
            return {"user": None, "workspaces": []}, session_cookie()
        if not user:
            if operation == "list":
                return {"user": None, "workspaces": []}, None
            raise WorkspaceError("Sign in to manage workspaces.", 401)
        owner, name = user
        if operation == "create":
            label = payload.get("name")
            if not isinstance(label, str) or not label.strip() or len(label.strip()) > 60:
                raise WorkspaceError("Enter a workspace name of 1–60 characters.")
            try:
                selected = db.execute("INSERT INTO workspaces(owner,name,settings) VALUES (?,?,?)",
                    (owner,label.strip(),json.dumps(clean_settings(payload.get("settings", {}))))).lastrowid
            except sqlite3.IntegrityError:
                raise WorkspaceError("You already have a workspace with that name.", 409) from None
            return {**listing(db,owner,name), "selected": selected}, None
        if operation == "save":
            selected = payload.get("id")
            if type(selected) is not int or not 0 < selected < 2**63:
                raise WorkspaceError("Select a workspace.")
            updated = db.execute("UPDATE workspaces SET settings=? WHERE owner=? AND id=?",
                (json.dumps(clean_settings(payload.get("settings"))),owner,selected))
            if not updated.rowcount:
                raise WorkspaceError("Workspace unavailable.", 404)
        return listing(db,owner,name), None


def listing(db, owner, name):
    rows = db.execute("SELECT id,name,settings FROM workspaces WHERE owner=? ORDER BY id", (owner,))
    return {"user": name, "workspaces": [{"id": row[0], "name": row[1], "settings": json.loads(row[2])} for row in rows]}
