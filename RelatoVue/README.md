# RelatoVue

RelatoVue turns CSV/TSV files, database views, and data quality results into interactive reports with record-level drill-through.

## Start here

- **Demo without setup:** Extract the ZIP, open `dist/index.html`, and choose **Sales records** or **Data quality outcomes** under **Try sample data**.
- **Run the server:** From the project folder, run `python server.py` and open [localhost:8765](http://127.0.0.1:8765/). Keep the terminal open. The server enables workspaces, database connections, and optional AI providers.
- **Move to another computer:** Copy the ZIP or run `git clone https://github.com/getavik/relatovue.git` with an account that has access to the private repository. Configure credentials separately on the new machine.

## Accounts and workspaces

1. On the server page, open **Guest · Local workspace** at the bottom left.
2. Select **Create account** or **Sign in**. New accounts get a **Personal** workspace.
3. Open the menu to **Create workspace**, **Switch workspace**, **Save settings**, or **Sign out**.
4. After loading data, adjust the report. Use **Save settings** to keep chart types, field selections, rule outcome mappings, reporting period, uniqueness key, and freshness settings. Matching field names are restored when you load compatible data.

Switching workspace or signing out clears the loaded dataset and chat. Uploaded files, accuracy reference files, database credentials, and AI keys are excluded from saved workspaces. Accounts and workspace settings live in `.relatovue/workspaces.sqlite3` on that server. The directory is excluded from Git. Guest demos remain available. Accounts are local to this installation. Organization SSO, shared workspaces, and remote multi-user hosting require a separate deployment setup.

## Security setup (local administrator)

Database and AI access now require sign-in **and explicit approval**. Guests can still use files, sample reports and the offline assistant. This remains a local tool, not a production multi-tenant service.

1. Create your account from the bottom-left workspace menu.
2. Copy `security.example.json` to `.relatovue/security.json`. Replace the placeholder with your lowercase username.
3. Grant only what is needed: `source:postgres`, `source:mysql`, `source:oracle`, `database:wizard`, or `ai:plan` in that user's `allow` list.
4. For AI, also add approved provider IDs to `aiProviders`: `openai`, `gemini`, `claude`, `grok`, `copilot`, `ollama`, or `local`. Credentials are configured separately below. Questions and metadata can contain confidential information; approve providers accordingly.
5. For the database wizard, add an exact destination to `databaseDestinations`, for example `{"engine":"postgres","host":"db.example.com","port":5432,"database":"sales","ca":""}`. Use a lowercase hostname; `ca` must exactly match the trusted CA path entered in the wizard. Only encrypted wizard connections are accepted.
6. Set `registrationEnabled` to `false` after approved accounts exist. Protect `.relatovue` with OS permissions. Never commit the policy, credentials or account database.

Restart after installing updated code. Policy edits apply to subsequent requests without restarting. Missing policy grants no database/AI access. Existing accounts and saved settings are preserved. Source grants cover the configured query; use restricted database views and read-only accounts to constrain its data. The policy does not mask files or enforce export restrictions.

See [Change management](CHANGE_MANAGEMENT.md) for the feasibility plan, rollout, verification, rollback and remaining enterprise requirements.

## Build a report

On **Start**, upload a file, connect to a database, or open a sample. **Dashboard** puts the dataset overview and report sections on one scrollable page. Click a chart item, quality count, or **Explore records** to inspect and export the source rows on a separate page.

RelatoVue recognizes common data quality outcome headers automatically. Raw data opens with performance charts, group comparisons, and a data profile. Use the **Data type** control to correct the selection for unusual schemas. Choose **Data quality outcomes** to map custom outcome columns, or **Aggregate data** to preview and explore other pre-aggregated sources. Performance trend charts for raw data use ISO dates. Donuts require nonnegative totals and at least one positive group.

CSV and TSV files can use comma, semicolon, or tab delimiters, UTF-8 or BOM-marked UTF-16, unique headers, and consistent row widths. The file limit is 10 MiB. **Change file** replaces the current dataset after a successful import.

## Connect a database

Install the driver in the Python environment that runs RelatoVue.

| Engine | Driver | Saved-query prefix |
| --- | --- | --- |
| PostgreSQL / AWS RDS | `python -m pip install "psycopg[binary]"` | `LEDGER_POSTGRES` |
| MySQL / AWS RDS | `python -m pip install "mysql-connector-python>=9.2"` | `LEDGER_MYSQL` |
| Oracle / Siebel reporting views | `python -m pip install oracledb` | `LEDGER_ORACLE` |

Run the server and choose **Set up a connection**. Test a read-only account, choose a schema and view or table, then pick columns and a row limit. PostgreSQL and MySQL verify TLS. Enter the trusted CA bundle path if required. Oracle defaults to TCPS and offers TCP where your DBA permits it.

For joins or source-side aggregation, set the engine’s `_CONNECTION` and `_QUERY` environment variables before starting the server. PostgreSQL connection JSON uses `conninfo`. MySQL uses `host`, `port`, `database`, `user`, `password`, and optional `ssl_ca`. Oracle uses `user`, `password`, `dsn`, and any required TLS settings. Test with `python server.py --check-source postgres` (or `mysql` or `oracle`). Loads are capped at 10,000 rows. Use an ordered saved query when the subset must be reproducible.

## Data quality

**Data profile** covers completeness, validity, accuracy, timeliness, consistency, and uniqueness. Inferred checks are candidates for steward review. Accuracy requires a trusted reference file and join keys. Timeliness requires an as-of date and a maximum age. **Export rule outcomes** downloads the current scope. Pass rate is passed divided by passed plus failed.

### Report executed data quality rules

Upload or connect to a source with rule names, populations, and valid and invalid counts. RelatoVue recognizes `valids` and `invalids` as well as singular count headers and opens the dashboard automatically. If required columns are missing, the dashboard opens **Outcome column mapping**. To adjust an automatic mapping, choose **Data quality outcomes** in the **Data type** control and open **Outcome column mapping**. Dates accept ISO format and day-first dates such as `18-11-2026`.

```csv
full_date,rule_name,population_name,population_party_type,population,invalids,valids,score
18-11-2026,CMPL_BSNNumber,Default,ALL,488167,64917,423250,86.7
18-11-2026,CMPL_BSNNumber,Deceased,NP,60196,235,59961,99.61
18-11-2026,VALD_Initials,Minors,NP,75262,1058,74204,98.59
```

Filter by rule, population name, party type, date range or score range. Use **Outcome breakdown** to group the filtered rows by population, rule, party type or date. A rule counts as failed if any included row has a positive invalid count. The dashboard counts each rule once overall and once in each group, using its rule key when supplied. Population grouping uses the name and party type when available. Unnamed populations are grouped by size and party type, so equal sizes can represent several underlying filters.

The dashboard keeps supplied scores and counts at the outcome level. For example, the largest invalid count in the sample is 64,917 for `CMPL_BSNNumber` in the Default population. Sort **Reported results** by invalid count, invalid rate, score or date. Pass rate is valid ÷ (valid + invalid), and **Unclassified** is the population outside those two counts. Score filters use the supplied numeric scale. A score of `86.7%` compares as 86.7, and `0.867` compares as 0.867.

The charts update with the filters. The ranking shows the groups with the most failed rules, or the rules with the largest single invalid count when grouped by rule. The distribution uses numeric reported scores, with calculated pass rates when the current selection has no numeric scores. Select a ranking bar, a score range, or a breakdown row to narrow the results table. Use **Explore filtered rows** to browse source rows, or export the breakdown or matching results as CSV. Rows with missing rule names or counts that are invalid or exceed their population appear under **View excluded rows**.

RelatoVue also accepts `dimension,rule,passed,failed` and derives each row's population from its counts, including `not_assessed` when supplied. Files with `dimension,rule,status` show **Reported checks** by dimension.

## Ask RelatoVue

Ask questions such as **Which account won the maximum revenue for the quarter ending April 2026?** or **Which quality rules failed?** The assistant can change the report and keep drill-through available. The built-in planner works offline. An optional model proposes actions that RelatoVue validates and calculates locally.

Type **connect to Gemini**, **connect to Claude**, **connect to Grok**, **connect to OpenAI**, **connect to Copilot Studio**, **connect to Ollama**, or **connect to local agent**. Follow the prompts, restart the server, then type **check** and the provider name.

| Provider | Server environment |
| --- | --- |
| OpenAI, Gemini, Claude, Grok | `RELATOVUE_AI_PROVIDER`, `RELATOVUE_AI_MODEL`, `RELATOVUE_AI_KEY` |
| Local compatible runtime | Provider `local`, model ID, optional `RELATOVUE_LOCAL_AI_PORT` (default 1234) and key. Serve `/v1/chat/completions` on loopback. |
| Ollama | `RELATOVUE_OLLAMA_MODEL` with Ollama on port 11434 |
| Copilot Studio | `RELATOVUE_COPILOT_SECRET` and optional `RELATOVUE_COPILOT_REGION`. Publish an agent that returns report-plan JSON using the contract in `server.py`. |

Keep keys out of chat and Git. Start the server in the same terminal where you set variables. In PowerShell, use a masked prompt:

```powershell
$env:RELATOVUE_AI_KEY = [System.Net.NetworkCredential]::new('', (Read-Host 'Paste your API key' -AsSecureString)).Password
```

Cloud providers receive the question and limited report metadata. Raw rows and database credentials stay local.

## Quick answers

| If you see this | Try this |
| --- | --- |
| Localhost refuses the connection | Run `python server.py`. If port 8765 is occupied, use `python server.py --port 8766` and open that port. |
| The old start screen still appears after an update | From the updated checkout, run `python server.py --port 8766` and open `http://127.0.0.1:8766/`. The current start screen says **Open a data source**. |
| Database connection fails or no tables appear | Check the driver, network/VPN, credentials, TLS certificate, and read permissions. |
| A replacement CSV leaves the old report open | Read the import error and check the headers, encoding, and row width. |
| Report totals differ from source totals | Check the loaded row limit, filters, and the scope of the saved query. |
| OpenAI returns HTTP 429 | Check API credits, spending limits, and rate limits. ChatGPT and API billing are separate. |
| Workspace settings don’t appear on another machine | Sign in to the same server installation. A fresh clone has an empty workspace store. |

Regression checks: `node tests/assistant.test.cjs` and `python -B -m unittest discover -s tests -p '*_test.py'`.
