# Change management

## Enterprise feasibility — 12 November 2026

**Feasible in stages; not enterprise-ready today.** The current UI and reporting engine can be retained. Shared sensitive-data hosting needs a production backend, identity integration, and infrastructure. Do not expose the loopback server through a proxy or network tunnel as an enterprise deployment.

| Improvement | Feasible now in this codebase | Remaining work / dependency | Release gate |
| --- | --- | --- | --- |
| Identity and access | Session checks, explicit service grants, registration control | Corporate OIDC/SSO tenant and MFA; server-owned datasets, roles and row/column policies | Direct API and cross-user isolation tests against identity provider |
| Privacy | Preserve local processing; minimise logged content | Classification, masking before browser delivery, retention/deletion, managed encryption keys; replace raw-row delivery where inappropriate | Restricted values absent from network responses, exports and backups |
| AI governance | Provider allowlist, per-user access, server plan validation | Per-workspace policy, sensitive-content filtering, approved region/retention contracts, adversarial evaluations | Injection and disclosure suite; no unauthorised side effects |
| Deployment/connectivity | Exact wizard destination allowlist and encrypted wizard connections | Production HTTP stack, TLS termination, secret store, egress firewall, query/concurrency budgets, saved-query TLS review | Load/security tests against actual databases and infrastructure |
| Audit/recovery | Structured API outcome events without request content | Central tamper-resistant retention, dataset/report lineage, client export auditing, backup/restore and penetration tests | Restore drill and independent security review |

Recommended sequence: access foundations → server-owned dataset/privacy model → SSO and deployment → AI governance → operational release validation. Infrastructure owner must supply the identity tenant, deployment target, secret store, logging destination and data classifications before those integrations can be completed and validated. No delivery estimate is committed until these choices are known.

## Implemented: phase 1 — local security foundations

- Database loads, wizard operations and model planning require an authenticated session plus an exact administrator grant.
- New accounts receive no service privileges automatically. Missing policy denies protected services; malformed/unreadable policy fails closed.
- Source availability refreshes after account changes. Configured sources without a grant are unavailable.
- Wizard connections require an approved engine/host/port/database/CA tuple. Oracle plaintext connections are rejected. DNS and actual network destinations still need infrastructure egress controls.
- AI requires both a user grant and an approved provider. Returned plans reject unknown actions, extra fields and unavailable field references before reaching the browser. Existing browser semantic checks remain in place.
- Login/registration share a ten-attempt-per-minute process-local budget. Registration can be disabled.
- API outcome events go to standard error; request bodies and URL queries are excluded. Added frame, referrer and device-permission headers.

### Behaviour changes and rollout

1. Back up the project and `.relatovue` directory securely while the server is stopped. Do not put the backup in Git or a distribution ZIP.
2. Read the administrator setup in README. Create a local account, then assign only required grants in `.relatovue/security.json`.
3. Restart the server to load the new code. Policy edits are read on subsequent requests; already-running requests and already-downloaded browser data are not revoked retroactively.
4. Check guest demo, sign-in, permitted source, denied source and AI policy before using real data.

Existing accounts/settings require no database migration. Database/AI access now fails closed until granted. File uploads and the offline assistant remain local and available to guests; this is **not** an enterprise guest-data restriction. Source grants apply to an entire configured saved query, and wizard grants permit the catalog/data allowed by the supplied database account at approved destinations. Workspaces still isolate settings, not independently authorised datasets. Use source-side restricted views and read-only credentials.

### Verification

Run `python -B -m unittest discover -s tests -p '*_test.py'` and `node tests/assistant.test.cjs`.

Verified: eight Python test cases covering workspace ownership, guest denial, grant revocation, logout/expiry, missing/malformed policy, cross-origin wizard requests, destination denial, provider denial, model-plan rejection, registration controls, throttling and log content minimisation. The existing 100-question analytical suite and integration checks pass. HTTP tests use a temporary loopback server and isolated temporary account stores; database/provider calls are mocked and make no paid requests.

Not verified: live RDS/Oracle connectivity, paid model services, corporate SSO, penetration testing, browser visual interaction, production concurrency or backup recovery. Tests reduce risk; they do not establish absence of bugs or compliance certification.

### Rollback

Stop the server and restore the prior code/package and backed-up local directory if necessary. No schema migration is introduced. **The prior version lacks these endpoint access controls**: rollback must remain local and must not be treated as a secure enterprise alternative.

### Known boundaries

Local OS users able to edit the policy or server files are trusted administrators. The policy file must be protected by OS permissions; credentials remain environment-managed. Audit output is neither persistent nor tamper-proof unless collected externally. The rate limit resets on restart and is shared by local users. AI prompts/metadata may contain confidential text; provider approval is not DLP. Existing sessions are not centrally administered. No claim of SSO, encrypted SQLite storage, tenant isolation or compliance certification is made.
