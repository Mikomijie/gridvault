# AGENTS.md — GridVault build manual

**Audience:** an autonomous coding agent (or engineer) implementing GridVault end to end.
**Authority:** this file is the operational contract. [PRD.md](PRD.md) is the requirements contract.
**Mode:** build the whole thing without asking questions. Every decision you might want to ask about has already been made below. Where this file is silent, choose the option that is simplest, most testable, and most secure — in that order — write it down in `docs/DECISIONS.md`, and continue.

---

## 1. Prime directive

Ship a production-grade clinical access-control system that a Nigerian hospital could actually run on a ward mini-PC, and that a hostile reviewer cannot embarrass. Concretely, you are done when every acceptance test in §9 passes on a clean clone and the judge script in §10 runs end to end with no manual patching.

**Work in the order given in §7.** Do not jump ahead to the visually impressive parts. The ledger and the policy engine are the product; the UI is how people see it.

---

## 2. Non-negotiable rules

Violating any of these means the work is rejected, regardless of how much else is finished.

1. **No fake tests.** A test that asserts nothing, a script that prints "all checks passing" and exits 0, a `expect(true).toBe(true)` — all forbidden. **First task of Phase 0 is to delete the existing root `npm test` script that prints `Running GridVault clinical verification suite: 14/14 checks passing.` and exits 0.** It is a lie; it is the single worst artefact currently in the repository.
2. **No placeholder code in a shipped path.** No `TODO: implement`, no `return mockPatients`, no `setTimeout` standing in for a network call. If something is genuinely out of scope, it is absent, and it is listed in `docs/DECISIONS.md` as out of scope — never stubbed to look implemented.
3. **Deny by default.** Every access decision goes through `policy.decide()`. No route handler, serializer, repository or React component may make an authorization decision on its own. There is exactly one `decide()` and it is unit-tested to 100% branch coverage.
4. **Never log PHI.** Not in pino output, not in `audit_logs.details`, not in an error message, not in a stack trace, not in a metric label. Log field _names_, decision codes, ids and counts. AT-315 and AT-908 grep for seed PHI values and fail the build if they appear.
5. **Never trust the client for authorization context.** Role, ward and shift come from the server-side user record. Do not accept them in a request body. (v1's login did; that is a vulnerability, not a feature.)
6. **The audit ledger is append-only.** There is no update path, no delete path, no HTTP endpoint that mutates it, and the SQLite triggers stay installed. Tamper demonstration goes through the CLI that writes to the file directly.
7. **Fail closed and fail loudly.** A missing key, a failed AAD check, a bad config, an unreachable witness — each produces an explicit error state, never a silent fallback to "allow" or to plaintext.
8. **No real patient data. Ever.** Seeds are synthetic. If a file ever contains something that looks like a real Nigerian NIN, phone number or hospital number belonging to a person, remove it.
9. **Commit working increments.** Each phase ends with a green test run and a commit. Never commit a broken `main`.
10. **Secrets never enter git.** `.env` is ignored; `.env.example` is committed with placeholders only.

---

## 3. Authoritative technical decisions

Do not deliberate. These are settled.

| Question          | Decision                                                                                                 | Why (do not re-litigate)                                                                                                     |
| :---------------- | :------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------- |
| Package manager   | **npm workspaces**, one root `package-lock.json`. Delete `pnpm-lock.yaml` and `.pnpm-store/` in Phase 0. | The repo currently has both a pnpm lockfile and a frontend `package-lock.json`. One tool, one lockfile, reproducible CI.     |
| Node version      | **22 LTS**, pinned in `.nvmrc` and `engines`                                                             | Matches the installed toolchain; `node:test`-grade crypto and stable `better-sqlite3` builds.                                |
| Backend language  | **TypeScript 5, `strict: true`, no `any` without an inline justification comment**                       | The policy engine and ledger are where type errors become security bugs.                                                     |
| Frontend language | **JavaScript + JSX, unchanged.** Do not convert the existing 1,500 lines of working UI to TypeScript.    | The existing pages are good work; a rewrite spends the budget on zero user-visible value. Add JSDoc types where non-obvious. |
| Backend framework | Express 4 + Zod 3                                                                                        | Boring, auditable, universally understood by reviewers.                                                                      |
| Database          | SQLite via `better-sqlite3` 11, WAL                                                                      | PRD §4.2. Synchronous API removes a whole class of race conditions in the ledger append path.                                |
| ORM               | **None.** Hand-written SQL behind a `Repository` interface, always parameterised.                        | The schema is small, the queries are security-critical, and an ORM hides what the audit reviewer needs to read.              |
| Password hashing  | `argon2` (argon2id), m=65536 KiB, t=3, p=4                                                               | PRD §6.6.                                                                                                                    |
| Tokens            | `jsonwebtoken` HS256 access (15 min) + opaque rotating refresh cookie                                    | PRD §6.6.                                                                                                                    |
| Test runners      | **Vitest** (unit + integration, with Supertest), **Playwright** (E2E + a11y via `@axe-core/playwright`)  | One runner for both workspaces; Playwright covers the offline and multi-persona flows a unit test cannot.                    |
| Lint / format     | ESLint (flat config) + Prettier; `eslint-plugin-security`; a custom rule banning template-literal SQL    | Rule 3 and §14.3 need enforcement, not good intentions.                                                                      |
| Logging           | `pino` with a redaction serializer                                                                       | PRD §14.7.                                                                                                                   |
| Ports             | API **8080**, frontend dev **5173**, nginx **8443** (TLS) / **8000** (plain, dev only), witness **9090** | Fixed so scripts, compose and tests agree.                                                                                   |
| Timezone          | `Africa/Lagos` everywhere, from config, never a hard-coded `+01:00` string in logic                      | PRD §6.5.                                                                                                                    |
| IDs               | UUIDv7 (`uuid` v10 `v7()`) for rows; `gv_` prefixed short ids for user-facing references                 | Time-sortable, index-friendly.                                                                                               |
| Money / i18n      | `en-NG`, single locale, all strings in `i18n/en.json`                                                    | NFR-12.                                                                                                                      |
| CI                | GitHub Actions: install → lint → typecheck → unit → integration → build → E2E → audit → coverage gate    | Every gate in PRD §19 runs automatically.                                                                                    |

---

## 4. Target repository layout

Create exactly this. Do not invent parallel structures.

```
gridvault/
├── AGENTS.md  PRD.md  README.md  RELEASE-NOTES.md
├── package.json                 # npm workspaces root + all scripts
├── package-lock.json  .nvmrc  .editorconfig  .gitignore
├── docker-compose.yml  .env.example
├── .github/workflows/ci.yml
├── docs/
│   ├── DOWNTIME-SOP.md          # PRD §10.1 verbatim + printable triage slip
│   ├── COMPLIANCE.md            # implemented vs designed vs facility-owned
│   ├── THREAT-MODEL.md          # PRD §5 expanded, with test ids
│   ├── OPERATIONS.md            # deploy, backup, restore, rotate, anchor, incident
│   ├── DECISIONS.md             # every judgement call you make, dated
│   └── API.md                   # generated from Zod schemas
├── diagrams/                    # existing .mmd files, kept current
├── backend/
│   ├── package.json  tsconfig.json  Dockerfile  vitest.config.ts
│   ├── config/abuse-rules.json  config/justifications.json
│   ├── migrations/001_init.sql  002_*.sql …
│   ├── src/
│   │   ├── index.ts                     # bootstrap: config → db → migrate → app → listen
│   │   ├── config/  env.ts  schema.ts   # Zod-validated, fails closed
│   │   ├── db/  connection.ts  migrate.ts  repositories/*.ts
│   │   ├── crypto/  hash.ts  field-encryption.ts  canonical-json.ts  signing.ts
│   │   ├── ledger/  append.ts  verify.ts  anchor.ts  export.ts
│   │   ├── policy/  decide.ts  field-groups.ts  duty.ts  reasons.ts
│   │   ├── serialize/  redact.ts  dto.ts
│   │   ├── auth/  login.ts  tokens.ts  sessions.ts  rate-limit.ts
│   │   ├── records/  service.ts  status.ts  source/{sqlite,upstream}.ts
│   │   ├── override/  execute.ts  lifecycle.ts  review.ts
│   │   ├── abuse/  engine.ts  rules/*.ts
│   │   ├── sync/  batch.ts  reconcile.ts  backfill.ts
│   │   ├── notify/  outbox.ts  drivers/*.ts
│   │   ├── http/  app.ts  routes/*.ts  middleware/*.ts  errors.ts
│   │   ├── observability/  logger.ts  metrics.ts
│   │   └── cli/  gv.ts  commands/*.ts
│   └── test/  unit/  integration/  fixtures/  helpers/
├── frontend/                    # existing Vite app, extended
│   ├── src/
│   │   ├── App.jsx  main.jsx
│   │   ├── pages/  Landing  Login  Dashboard  PatientDossier  Handover
│   │   │           Admissions  Security  AdminUsers
│   │   ├── components/  RedactionChip  BreakGlassModal  EmergencyBanner
│   │   │                LedgerInspector  AbuseConsole  OfflineBar  LockOverlay
│   │   │                VitalsForm  PatientCard  SBARSheet
│   │   ├── context/  AuthProvider  PolicyProvider  OfflineProvider  SecurityProvider
│   │   ├── lib/  api.js  cache.js  queue.js  crypto.js  heartbeat.js
│   │   ├── i18n/en.json  styles/globals.css
│   │   └── sw.js
│   └── test/  unit/  e2e/
├── witness/                     # tiny independent anchor receiver
│   ├── package.json  Dockerfile  src/index.ts
└── scripts/  seed.ts  load-test.ts  restore-drill.sh
```

---

## 5. Conventions

**Errors.** One `AppError` class with `code`, `httpStatus`, `reasonCode`, `details`, `cause`. One error middleware. Never `res.status(500).json({error: e.message})` — that leaks internals and possibly PHI.

**Service boundaries.** Route handler = parse (Zod) → call service → serialize. No business logic, no SQL, no policy decision in a handler.

**Ledger writes.** Every state change appends to the ledger _inside the same transaction_ as the change. A vitals row that exists without its `RECORD_VITALS` entry is a bug.

**Time.** `now()` is injected (`Clock` interface), never `new Date()` inline, so duty-state and expiry logic is testable without sleeping.

**Naming.** `snake_case` in SQL and JSON payloads; `camelCase` in TypeScript variables; `SCREAMING_SNAKE` for action names, reason codes and rule ids.

**Tests.** Name files `<unit>.test.ts` / `<flow>.spec.ts`. Every acceptance test id from §9 appears in a test title exactly as written (e.g. `it('AT-105: nurse cannot read an ICU patient', …)`) so `npx vitest -t AT-105` runs it.

**Commits.** Conventional commits, one per phase or logical unit, imperative mood, and each ends with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

**Branch.** Work on `main` is acceptable for this project; if you open a PR, end the description with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## 6. Commands (define these exactly; scripts must do what their names say)

```bash
npm ci                       # install workspaces
npm run dev                  # api + frontend concurrently
npm run build                # typecheck + build both workspaces
npm test                     # unit + integration; MUST fail when a test fails
npm run test:unit
npm run test:integration
npm run test:e2e             # playwright
npm run test:coverage        # enforces NFR-10 thresholds; exits non-zero below
npm run lint  npm run typecheck  npm run format
npm run gv -- <command>      # operator CLI
npm run demo:reset           # wipe db, seed demo profile, print personas
npm run demo:tamper          # corrupt one ledger row via direct file access
npm run judge                # run the §10 script end to end, print a report
```

Operator CLI commands: `seed`, `migrate`, `verify-ledger`, `export-ledger`, `anchor`, `backup`, `restore`, `rotate-key`, `subject-access`, `create-user`, `demo:tamper`.

---

## 7. Build phases

Each phase: do the work, make its tests pass, run `npm test && npm run lint && npm run typecheck`, commit. Do not start a phase before its predecessor is green.

### P0 — Workspace and honesty pass

- Convert to npm workspaces (`"workspaces": ["backend", "frontend", "witness"]`). Delete `pnpm-lock.yaml` and `.pnpm-store/`.
- **Delete the fraudulent `test` script** in the root `package.json` and replace it with a real one.
- Fix `.gitignore`: it currently ignores `/*` and whitelists a fixed list, which silently excludes `PRD.md`, `AGENTS.md`, `docs/`, `scripts/`, `witness/`, `docker-compose.yml` and `.env.example`. Add them, and verify with `git check-ignore -v <path>` that every intended file is trackable.
- Scaffold `backend/` (TS, ESLint, Prettier, Vitest), `witness/`, `docs/`, `scripts/`, `.github/workflows/ci.yml`, `.nvmrc`, `.env.example`.
- Add the custom ESLint rule banning template-literal SQL and a rule banning direct repository imports from `src/http/routes/`.
- **DoD:** CI runs and fails on a deliberately broken test; `npm test` exits non-zero when one test fails. Prove it, then remove the broken test.

### P1 — Data layer and crypto

- `migrations/001_init.sql` = PRD §11 verbatim, including the two append-only triggers. Migration runner is transactional, checksummed, forward-only, and refuses to run when a recorded checksum no longer matches.
- `crypto/canonical-json.ts`: deterministic, key-sorted, ASCII-escaped, rejects `NaN`/`Infinity`/cycles.
- `crypto/field-encryption.ts`: AES-256-GCM, `v<ver>:<iv>:<ct>:<tag>`, AAD = `patient_id:column:key_version`; decrypt throws `EncryptionIntegrityError` on any AAD/tag mismatch.
- Repositories for every table. Seeder for `demo`, `load`, `empty` profiles (PRD §16 patients exactly as specified).
- **DoD:** AT-001…AT-012.

### P2 — Ledger

- `append()` inside an `IMMEDIATE` transaction; `prev_hash` read under the same lock; genesis handling; concurrency-safe under 50 parallel appends.
- `verify()` streaming, returning `status`, `failure_kind`, `broken_at_index`, `head_hash`, `witness`, `duration_ms`.
- `anchor()` producing signed Ed25519 receipts; the witness service stores them append-only under separate credentials; divergence detection.
- `export()` to JSONL + a standalone `verify-ledger --file` path that touches neither DB nor network.
- `demo:tamper` CLI: opens the db file, drops the trigger, mutates one row, reinstalls the trigger. Refuses under `NODE_ENV=production` without the explicit flag.
- **DoD:** AT-301…AT-315.

### P3 — Authentication and session

- Login (Argon2id verify), refresh rotation with reuse detection, logout, PIN unlock, `/auth/me` with duty state, rate limiting and lockout, session families.
- `LOGIN`, `LOGIN_FAILED`, `LOGOUT`, `SESSION_LOCK`, `SESSION_UNLOCK` ledger entries.
- Config validator that refuses to boot on any insecure production configuration (PRD §14.5).
- **DoD:** AT-013…AT-025.

### P4 — Policy, redaction, records API

- `policy/decide.ts` implementing PRD §6.1 exactly, in order, returning the full `Decision` with obligations. 100% branch coverage.
- `duty.ts` with the midnight-wrapping night shift and the 30-minute grace window, driven by the injected `Clock`.
- `serialize/redact.ts`: restricted values never enter a DTO; `_meta.redactions` always present.
- All of PRD §12.3, plus the `RecordSource` interface with the SQLite implementation and the contract test suite the upstream implementation must also satisfy.
- **DoD:** AT-101…AT-119.

### P5 — Break-glass

- `POST /api/override/execute`: PIN verify → grant row → ledger entry → outbox dispatch → scoped grant, all in one transaction; ≤ 400 ms p95.
- Lifecycle: expiry, close, revoke (effective on the next request), review queue.
- Grants are looked up server-side per request; never carried in the JWT.
- `SENSITIVE` is read-only under a grant.
- **DoD:** AT-201…AT-212.

### P6 — Abuse engine and security console API

- Rules `RULE-ABUSE-01…09` as individual, individually-tested modules with config-driven thresholds validated at boot.
- Synchronous evaluation that can _block_, before serialization.
- Alert lifecycle, self-resolution prohibition, SSE streams for alerts and ledger.
- `POST /api/abuse/demo/clerk-probe` performs a genuine authenticated request as `RC-1029` — it must not insert a fabricated alert row.
- **DoD:** AT-401…AT-409.

### P7 — Offline resilience

- Frontend: encrypted IndexedDB cache with the §10.3 purge lifecycle, mutation queue, heartbeat detection, sync-on-reconnect, offline bar, simulation toggle, service worker for the app shell.
- Backend: `POST /api/sync/batch` with idempotency, `device_seq` ordering, additive merges, `409` on demographic version conflicts, `SYNC_GAP_DETECTED`, clock-skew flagging, `SYNC_REPLAY` ledger entries.
- Paper `POST /api/sync/backfill` with dual timestamps and transcriber attribution.
- Offline break-glass per PRD §10.2.
- `docs/DOWNTIME-SOP.md` + printable triage slip.
- **DoD:** AT-501…AT-514.

### P8 — Frontend completion

- Wire `LoginPage` to the real API (remove the `setTimeout` mock and the client-chosen ward/shift).
- `DashboardPage`: real roster, filters, search, patient cards from the API, no hardcoded personas.
- Patient dossier with tabs and redaction chips carrying server-supplied reasons.
- Break-glass modal, emergency banner, ledger inspector, abuse console, offline bar, lock overlay, admissions queue, SBAR handover with watermark, user admin.
- Route guards, error boundaries, loading and empty states, `aria-live` announcements, focus traps.
- Landing page edited so every claim matches `docs/COMPLIANCE.md`. Remove any unearned certification or endorsement language.
- **DoD:** AT-601…AT-628.

### P9 — Production hardening and delivery

- `Dockerfile` (backend, multi-stage, non-root `node`), `Dockerfile` (frontend → nginx with the §14.2 headers), witness Dockerfile, `docker-compose.yml` with named volumes and healthchecks.
- Backups every 4 h with SHA-256 manifests, retention policy, and a **tested** restore drill script.
- Helmet/CSP/HSTS/CORS, metrics endpoint, log rotation, graceful shutdown, `/health/ready` gating on migrations + key + chain head.
- Load test (500 patients / 50k ledger / 40 virtual terminals) proving NFR-1, NFR-3, NFR-6.
- All five `docs/` files complete. README rewritten to match reality, with a 5-minute quickstart.
- **DoD:** AT-901…AT-912 and PRD §19 in full.

---

## 8. Environment variables

`.env.example` must list all of these with descriptions and safe placeholders.

| Variable                    | Default                 | Notes                                                                                 |
| :-------------------------- | :---------------------- | :------------------------------------------------------------------------------------ |
| `NODE_ENV`                  | `development`           | `production` activates every hard config check                                        |
| `PORT`                      | `8080`                  | API                                                                                   |
| `DATABASE_PATH`             | `./data/gridvault.db`   | WAL files live alongside                                                              |
| `GRIDVAULT_MASTER_KEY`      | —                       | 32 bytes base64. **Boot fails if missing, short, or the dev value in production**     |
| `JWT_SECRET`                | —                       | ≥ 32 bytes. Boot fails if shorter                                                     |
| `ACCESS_TOKEN_TTL_MINUTES`  | `15`                    |                                                                                       |
| `REFRESH_TOKEN_TTL_HOURS`   | `8`                     |                                                                                       |
| `IDLE_LOCK_SECONDS`         | `180`                   | PRD §13.3                                                                             |
| `HARD_LOCK_SECONDS`         | `900`                   | Memory purge                                                                          |
| `OVERRIDE_TTL_MINUTES`      | `60`                    | Break-glass grant                                                                     |
| `SHIFT_GRACE_MINUTES`       | `30`                    | Handover window                                                                       |
| `TIMEZONE`                  | `Africa/Lagos`          |                                                                                       |
| `ANCHOR_INTERVAL_MINUTES`   | `60`                    | `5` in demo                                                                           |
| `WITNESS_URL`               | `http://witness:9090`   | Outbound-only                                                                         |
| `WITNESS_API_KEY`           | —                       | Separate credential from everything else                                              |
| `NODE_SIGNING_KEY`          | —                       | Ed25519 private key for anchor receipts                                               |
| `DEMO_MODE`                 | `false`                 | Enables personas + demo endpoints. **Boot fails if true while `NODE_ENV=production`** |
| `ALLOW_INSECURE_HTTP`       | `false`                 | Required to run without TLS in production                                             |
| `RATE_LIMIT_LOGIN_ATTEMPTS` | `5`                     | per 10 min                                                                            |
| `LOGIN_LOCKOUT_MINUTES`     | `15`                    |                                                                                       |
| `BACKUP_INTERVAL_HOURS`     | `4`                     |                                                                                       |
| `LOG_LEVEL`                 | `info`                  |                                                                                       |
| `VITE_API_BASE_URL`         | `http://localhost:8080` | Frontend                                                                              |

---

## 9. Acceptance tests

**These are the specification.** Write them as automated tests with the id in the title. `[U]` unit, `[I]` integration (Supertest against a real in-memory/temp SQLite), `[E]` Playwright end-to-end, `[O]` operational script. Every test must be deterministic — inject the clock, seed fixed data, no `sleep`-based timing assertions.

### 9.1 Data layer and crypto

| ID     | Type | Test                                                                                             | Expected                                                                                      |
| :----- | :--- | :----------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------- |
| AT-001 | U    | Canonical JSON sorts keys, escapes non-ASCII, is byte-identical across 1,000 shuffled-key inputs | identical output every time                                                                   |
| AT-002 | U    | Canonical JSON rejects `NaN`, `Infinity`, `undefined`, circular refs                             | throws typed error                                                                            |
| AT-003 | U    | Encrypt→decrypt round-trips every sensitive field, including empty string and 10 KB text         | plaintext recovered                                                                           |
| AT-004 | U    | Ciphertext for the same plaintext differs across writes (random IV)                              | no two equal                                                                                  |
| AT-005 | U    | Decrypting Patient X's `hiv_status_enc` under Patient Y's `patient_id`                           | throws `EncryptionIntegrityError`; no plaintext returned                                      |
| AT-006 | U    | Decrypting under a mismatched `column_name` or `key_version` AAD                                 | throws                                                                                        |
| AT-007 | U    | Flipping one bit of ciphertext or tag                                                            | throws; never returns garbage plaintext                                                       |
| AT-008 | I    | `migrate` applied twice                                                                          | idempotent; second run applies nothing; checksum recorded                                     |
| AT-009 | I    | Altering a recorded migration file then re-running                                               | refuses to start, names the migration                                                         |
| AT-010 | I    | `UPDATE audit_logs SET staff_id='x' WHERE log_index=2` via raw SQL                               | `SQLITE_CONSTRAINT`, message `audit_logs is append-only`                                      |
| AT-011 | I    | `DELETE FROM audit_logs WHERE log_index=2` via raw SQL                                           | same abort                                                                                    |
| AT-012 | I    | `seed --profile demo`                                                                            | exactly the 5 staff and 12 patients of PRD §16; the four named patients match field-for-field |

### 9.2 Authentication, session, duty

| ID     | Type | Test                                                                            | Expected                                                                                       |
| :----- | :--- | :------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------- |
| AT-013 | I    | Login with correct credentials                                                  | `200`, access token, refresh cookie `HttpOnly; Secure; SameSite=Strict`, `LOGIN` ledger entry  |
| AT-014 | I    | Login with a body containing `{role:'admin', ward:'icu'}`                       | those fields are ignored; the token carries the record's role and ward                         |
| AT-015 | I    | Login with wrong password                                                       | `401`, generic message, `LOGIN_FAILED` entry, **no password value anywhere in logs or ledger** |
| AT-016 | I    | 5 failed logins then a correct one                                              | 6th is `429` and locked for 15 min; `RULE-ABUSE-08` alert raised                               |
| AT-017 | I    | Expired access token                                                            | `401` with `code: TOKEN_EXPIRED`                                                               |
| AT-018 | I    | Refresh rotation                                                                | new access token + new cookie; the old refresh token is dead                                   |
| AT-019 | I    | Replaying a rotated refresh token                                               | `401`, whole session family revoked, `RULE-ABUSE-09` CRITICAL alert                            |
| AT-020 | U    | `duty_state` at 21:59, 22:00, 23:59, 00:00, 05:59, 06:00 for a night-shift user | `off_duty, on_duty, on_duty, on_duty, on_duty, off_duty`                                       |
| AT-021 | U    | `duty_state` at 14:15 and 14:31 for a morning-shift user                        | `handover_grace` then `off_duty`                                                               |
| AT-022 | I    | Read during `handover_grace`                                                    | `200`                                                                                          |
| AT-023 | I    | Write during `handover_grace`                                                   | `403 OFF_DUTY_WRITE`                                                                           |
| AT-024 | I    | Request with a valid `scheduled_extension` outside shift hours                  | `200`, `on_duty`                                                                               |
| AT-025 | I    | Suspended / expired account                                                     | `401 ACCOUNT_INACTIVE` / `ACCOUNT_EXPIRED`, even with a valid password                         |

### 9.3 Policy and redaction

| ID     | Type | Test                                                                                 | Expected                                                                                                                                            |
| :----- | :--- | :----------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------- |
| AT-101 | I    | Doctor `GV-9042` (ICU) reads `HOSP-LOS-2025-084`                                     | `200`, all groups present including `SENSITIVE`, `VIEW_RECORD` + `VIEW_SENSITIVE` entries                                                           |
| AT-102 | I    | Nurse `SN-7742` (ward_a) reads `HOSP-LOS-2025-082`                                   | `200`; `SENSITIVE` visible, read-only; a write to `hiv_status` returns `403 ROLE_CANNOT_WRITE`                                                      |
| AT-103 | I    | Clerk `RC-1029` reads a patient **in his intake queue**                              | `200`; `DEMOGRAPHICS` + `LOGISTICS` present; `CLINICAL` and `SENSITIVE` are `"[RESTRICTED]"`; `_meta.redactions` names `CLERK_NO_CLINICAL`          |
| AT-104 | I    | Clerk `RC-1029` reads `HOSP-LOS-2025-082` (**not** in his queue)                     | `403 CLERK_OUT_OF_QUEUE`, `RULE-ABUSE-01` CRITICAL alert, `ACCESS_DENIED` entry                                                                     |
| AT-105 | I    | Nurse `SN-7742` (ward_a) reads ICU patient `HOSP-LOS-2025-084`                       | `403 WARD_MISMATCH` with `can_break_glass: true`; `RULE-ABUSE-02`; zero clinical bytes in the body                                                  |
| AT-106 | I    | Admin `AD-0012` reads any patient                                                    | `200` with `DEMOGRAPHICS` limited to id/ward; `CLINICAL` + `SENSITIVE` restricted; `RULE-ABUSE-05` CRITICAL raised on an explicit sensitive request |
| AT-107 | I    | Admin lists `/api/audit/logs`                                                        | `200`, full ledger                                                                                                                                  |
| AT-108 | I    | Nurse requests `/api/audit/logs`                                                     | `403`                                                                                                                                               |
| AT-109 | I    | Doctor requests `/api/audit/logs`                                                    | `200`, own-ward events only; no other ward's rows present                                                                                           |
| AT-110 | I    | Roster as nurse `SN-7742`                                                            | only `ward_a` patients; ICU patients absent entirely                                                                                                |
| AT-111 | I    | Roster as doctor with `?ward=maternity`                                              | off-ward entries appear with masked names (`A•••• O••••`) and `can_break_glass: true`, no clinical fields                                           |
| AT-112 | I    | Roster as clerk                                                                      | admissions-queue patients only; no clinical fields; no off-ward masked entries                                                                      |
| AT-113 | I    | `GET /api/patients/HOSP-LOS-2025-084` as clerk                                       | `404` (enumeration protection), not `403`                                                                                                           |
| AT-114 | U    | `decide()` branch coverage                                                           | 100%; every `reason_code` exercised at least once                                                                                                   |
| AT-115 | E    | Idle 3 min on the dossier                                                            | lock overlay; `document.body.innerText` contains no patient name, diagnosis or vitals; PIN restores; after 15 min a reload forces `/login`          |
| AT-116 | I    | Raw response bytes for every redacted request across the matrix                      | seed sensitive plaintexts (`Reactive (Confirmed)`, `Hb SS`, `Hb AS`, the psychiatric note) appear **nowhere** in any response body                  |
| AT-117 | I    | Swap `hiv_status_enc` between two patient rows via raw SQL, then read as doctor      | `500`-class `ENCRYPTION_INTEGRITY_FAILURE`, CRITICAL alert, no plaintext shown                                                                      |
| AT-118 | I    | **Matrix sweep:** 5 principals × 4 patients × 7 field groups × {read, write}         | every cell matches PRD §6.3 exactly; the test table is written out explicitly, not generated from the implementation                                |
| AT-119 | I    | `RecordSource` contract suite against `SqliteRecordSource` (and any future upstream) | identical policy outcomes for every case in AT-118                                                                                                  |

### 9.4 Break-glass

| ID     | Type | Test                                                                                         | Expected                                                                                                                     |
| :----- | :--- | :------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------- |
| AT-201 | I    | Nurse executes override on `HOSP-LOS-2025-084` with `ACUTE_TRAUMA_UNCONSCIOUS` + correct PIN | `201` with `override_id`, `audit_index`, `expires_at`, `scope`                                                               |
| AT-202 | I    | Override with a wrong PIN                                                                    | `401`; no grant; `EMERGENCY_OVERRIDE_REQUESTED` denial entry; 3 failures throttle                                            |
| AT-203 | I    | Override with `OTHER` and 5-character notes                                                  | `400`; ≥ 20 characters required                                                                                              |
| AT-204 | E    | Click **Emergency Clinical Override** → select reason → PIN → confirm                        | chart readable; ≤ 2 interactions after the button; p95 ≤ 1000 ms measured over 20 runs                                       |
| AT-205 | I    | Read the granted patient after the grant                                                     | `200` with `CLINICAL` RW and `SENSITIVE` **read-only**; a sensitive write returns `403`                                      |
| AT-206 | I    | Ledger after a grant                                                                         | `EMERGENCY_OVERRIDE_GRANTED` present, chained, `verify` still `HEALTHY`; `details` carries the justification code but no PHI |
| AT-207 | I    | Outbox after a grant                                                                         | two `PENDING`/`DISPATCHED` rows (CMO, charge nurse), `priority: HIGH`, written in the same transaction as the grant          |
| AT-208 | I    | Notifier driver throws                                                                       | the grant still succeeds; the outbox row persists; `DISPATCH_DEGRADED` surfaces after 15 min                                 |
| AT-209 | I    | Second patient in the same ward under an existing grant                                      | `403` — a grant is scoped to one patient                                                                                     |
| AT-210 | I    | Clock advanced past `expires_at`                                                             | `410 GRANT_EXPIRED`; `EXPIRED` state; re-reading requires a fresh override                                                   |
| AT-211 | I    | CMO revokes an active grant                                                                  | the clinician's very next request is `403`; `EMERGENCY_OVERRIDE_REVOKED` entry                                               |
| AT-212 | I    | Two overrides by one clinician within 60 min                                                 | both succeed (care first); `RULE-ABUSE-04` CRITICAL; escalated dispatch                                                      |

### 9.5 Ledger and witness

| ID     | Type | Test                                                           | Expected                                                                                                                      |
| :----- | :--- | :------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------- |
| AT-301 | U    | Genesis entry                                                  | `prev_hash` = 64 zeros; `current_hash` = SHA-256 of the canonical payload, verified against an independently computed fixture |
| AT-302 | U    | Hash includes the `gridvault.audit.v2` domain separator        | a payload without it produces a different digest                                                                              |
| AT-303 | U    | `details` containing `                                         | `, `"`, newlines, emoji, 8 KB of text                                                                                         | chain still verifies; no delimiter ambiguity (regression test for the v1 pipe format) |
| AT-304 | I    | 50 concurrent appends                                          | 50 dense indices, no duplicate `prev_hash`, chain verifies                                                                    |
| AT-305 | I    | Edit `staff_id` at index 7 (triggers dropped) then verify      | `TAMPERED`, `failure_kind: HASH_MISMATCH`, `broken_at_index: 7`                                                               |
| AT-306 | I    | Delete index 5                                                 | `TRUNCATED`, `failure_kind: INDEX_GAP`, `broken_at_index: 5`                                                                  |
| AT-307 | I    | Insert a forged row between 5 and 6                            | detected, exact index reported                                                                                                |
| AT-308 | I    | Reorder two rows' timestamps                                   | `TIMESTAMP_REGRESSION` at the first offending index                                                                           |
| AT-309 | I    | Recompute the entire chain after an edit (root-level attacker) | local verify says `HEALTHY`, but `witness.status` = `WITNESS_DIVERGED`; overall `status` = `WITNESS_DIVERGED`                 |
| AT-310 | I    | Anchor receipt creation                                        | Ed25519 signature verifies against the node public key; witness stores it; `chain_anchors` row `ACKNOWLEDGED`                 |
| AT-311 | I    | Witness unreachable                                            | receipts queue `PENDING`; clinical requests unaffected; console shows anchor lag                                              |
| AT-312 | O    | Verify a 50,000-entry ledger                                   | `HEALTHY` in < 5 s, memory ≤ 128 MB                                                                                           |
| AT-313 | O    | `demo:tamper` then `GET /api/audit/verify`                     | exact `broken_at_index` and `failure_kind`; the UI banner shows both                                                          |
| AT-314 | O    | `export-ledger` → hand-edit one line → `verify-ledger --file`  | `TAMPERED` at the edited index, with no DB and no network access                                                              |
| AT-315 | I    | Grep the entire ledger after a full demo run                   | no seed PHI value appears in any `details` field                                                                              |

### 9.6 Abuse detection

| ID     | Type | Test                                                              | Expected                                                                                                                              |
| :----- | :--- | :---------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------ |
| AT-401 | I    | **The mandatory demo:** clerk `RC-1029` opens `HOSP-LOS-2025-082` | `403`; `RULE-ABUSE-01` CRITICAL `FLAGGED`; two ledger entries; alert's `decision_id` matches a real policy decision from that request |
| AT-402 | E    | **Run abuse demonstration** button in the security console        | the alert card appears over SSE without a page reload, within 2 s, showing staff, target, rule, terminal and IP                       |
| AT-403 | I    | Three off-ward attempts in 15 min                                 | `RULE-ABUSE-02` escalates WARNING → CRITICAL on the third                                                                             |
| AT-404 | I    | Request while `off_duty`                                          | `RULE-ABUSE-03` WARNING; charge-nurse notification queued                                                                             |
| AT-405 | I    | Two grants in 60 min                                              | `RULE-ABUSE-04` CRITICAL (same as AT-212, asserted from the alert side)                                                               |
| AT-406 | I    | Admin explicitly requests `SENSITIVE`                             | `RULE-ABUSE-05`; alert recipients include the CMO and the DPO role, and exclude the acting admin                                      |
| AT-407 | I    | 21 distinct patient reads in 5 min by one doctor                  | `RULE-ABUSE-06` WARNING; subsequent requests throttled to 1 rps                                                                       |
| AT-408 | I    | The staff member named in an alert tries to resolve it            | `403 CANNOT_RESOLVE_OWN_ALERT`                                                                                                        |
| AT-409 | I    | Boot with an invalid threshold in `abuse-rules.json`              | startup fails with a named validation error; the server does not start with a rule silently disabled                                  |

### 9.7 Offline and sync

| ID     | Type | Test                                                                           | Expected                                                                                                                         |
| :----- | :--- | :----------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------- |
| AT-501 | E    | Go offline (Playwright `context.setOffline(true)`), open a cached ward patient | dossier renders from cache; amber offline bar; no crash, no infinite spinner                                                     |
| AT-502 | E    | Record vitals offline                                                          | accepted, queued, badge shows `1 item queued`, value visible locally with an `unsynced` tag                                      |
| AT-503 | E    | Back online                                                                    | auto-sync within one heartbeat; badge clears; success toast names the count                                                      |
| AT-504 | I    | `POST /api/sync/batch` with 10 mutations                                       | all applied, `is_offline_sync=1`, `source='offline_sync'`, 10 `SYNC_REPLAY` entries, chain verifies                              |
| AT-505 | I    | 3 devices × 10 mutations, interleaved                                          | all 30 applied, ordered by `device_seq` within each device, none lost                                                            |
| AT-506 | I    | Batch with a `device_seq` gap (41, 43)                                         | applied; `SYNC_GAP_DETECTED` warning naming device and missing range                                                             |
| AT-507 | I    | Mutation with `captured_at` 45 min in the past                                 | stored with both timestamps and `clock_skew_flag=1`; ordering still by `device_seq`                                              |
| AT-508 | I    | Replay an identical batch twice                                                | second call reports `duplicates_ignored: N`, creates zero new rows and zero new ledger entries; final state byte-identical       |
| AT-509 | I    | Demographic patch with a stale `base_version`                                  | `409` with both versions; a reconciliation task is queued; no silent overwrite                                                   |
| AT-510 | E    | Offline break-glass on a cached patient                                        | local emergency read granted, red banner shown; on reconnect the real grant + CMO dispatch are created and the delay is recorded |
| AT-511 | E    | Logout while items are queued                                                  | the user is warned; the cache is purged only after sync or explicit discard; discarding is itself a ledger entry on reconnect    |
| AT-512 | E    | IndexedDB contents while offline                                               | values are ciphertext; no plaintext patient name or diagnosis in any store; nothing in `localStorage`/`sessionStorage`           |
| AT-513 | I    | Paper backfill of 3 slips                                                      | `source='paper_backfill'`, both timestamps present, transcriber recorded, `BACKFILL_PAPER_SLIP` entries                          |
| AT-514 | O    | Kill the API with `-9` mid-batch, restart                                      | no partial batch applied (transactional); replay completes; chain `HEALTHY`                                                      |

### 9.8 Frontend and end-to-end journeys

| ID     | Type | Test                                                                       | Expected                                                                                              |
| :----- | :--- | :------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------- |
| AT-601 | E    | Landing page loads                                                         | no console errors; every compliance claim on the page appears in `docs/COMPLIANCE.md`                 |
| AT-602 | E    | Login as each of the 5 personas                                            | correct dashboard surface for each role                                                               |
| AT-603 | E    | Login with a wrong password                                                | inline error, no navigation, no token in storage                                                      |
| AT-604 | E    | Nurse dashboard                                                            | only Ward A patients; correct vitals; correct auto-triage badges                                      |
| AT-605 | E    | Nurse opens the Protected data tab for a ward patient                      | HIV, genotype, pregnancy visible; edit controls absent                                                |
| AT-606 | E    | Clerk opens a queue patient's dossier                                      | lock chips with the reason text; the values are absent from the DOM (assert via `page.content()`)     |
| AT-607 | E    | Clerk attempts an out-of-queue patient                                     | denial screen explaining which dimension denied; abuse alert raised                                   |
| AT-608 | E    | Doctor break-glass on the ICU trauma patient from another ward             | chart opens; red banner with the audit index and countdown                                            |
| AT-609 | E    | **End emergency access**                                                   | banner clears; the chart re-locks on the next navigation                                              |
| AT-610 | E    | Security console ledger inspector                                          | rows render with truncated hashes; copy works; filters work; virtualised at 10,000 rows               |
| AT-611 | E    | **Verify chain** button                                                    | `HEALTHY` banner with entry count and duration                                                        |
| AT-612 | E    | After `demo:tamper`, **Verify chain**                                      | red banner naming `broken_at_index` and `failure_kind`; the offending row is highlighted in the table |
| AT-613 | E    | Abuse console live feed                                                    | new alerts arrive over SSE without a reload                                                           |
| AT-614 | E    | Override review queue                                                      | CMO acknowledges a grant; state changes; a ledger entry is written                                    |
| AT-615 | E    | Offline toggle                                                             | amber bar, queue badge, **Sync now**, last-sync time                                                  |
| AT-616 | E    | Vitals form validation                                                     | out-of-range values rejected client- and server-side with the same message                            |
| AT-617 | E    | SBAR handover print view                                                   | watermark contains the staff name, staff id, terminal and timestamp; `EXPORT_HANDOVER` logged         |
| AT-618 | E    | Keyboard-only run of roster → patient → vitals → save                      | fully operable; visible focus at every step                                                           |
| AT-619 | E    | Screen-reader semantics on the break-glass modal                           | focus trapped, labelled, `aria-live` announces the grant                                              |
| AT-620 | E    | Tablet viewport 768×1024 portrait                                          | no horizontal scroll; touch targets ≥ 44 px                                                           |
| AT-621 | E    | Token expiry mid-session                                                   | silent refresh; the user does not lose form input                                                     |
| AT-622 | E    | API returns 500                                                            | error boundary with a retry, not a white screen                                                       |
| AT-623 | E    | Cold boot with the network disabled                                        | the app shell and a cached roster render from the service worker                                      |
| AT-624 | U    | `RedactionChip` renders `reason_code` text from `_meta`                    | no role-based logic in the component                                                                  |
| AT-625 | U    | `OfflineProvider` queue survives a page reload                             | mutations persist in IndexedDB                                                                        |
| AT-626 | E    | Copy attempt on a sensitive field                                          | clipboard is not populated                                                                            |
| AT-627 | E    | No PHI in `localStorage`/`sessionStorage` at any point in the full journey | assert after each step                                                                                |
| AT-628 | E    | Every user-facing string comes from `i18n/en.json`                         | a lint/scan step finds no hard-coded display strings in components                                    |

### 9.9 Production readiness

| ID     | Type | Test                                                                                                     | Expected                                                                                                       |
| :----- | :--- | :------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------- |
| AT-901 | O    | Load profile: roster, dossier, vitals write under 40 virtual terminals                                   | NFR-1 p95 budgets met; report committed to `docs/`                                                             |
| AT-902 | O    | `docker compose up` on a clean machine                                                                   | healthy, seeded, reachable in ≤ 90 s                                                                           |
| AT-903 | E    | axe-core on landing, login, dashboard, dossier, break-glass modal                                        | zero violations                                                                                                |
| AT-904 | O    | `npm audit --omit=dev`                                                                                   | zero high or critical                                                                                          |
| AT-905 | O    | **Restore drill:** backup → destroy the DB → restore → verify                                            | manifest checksum matches; chain `HEALTHY`; patient count and ledger head identical                            |
| AT-906 | O    | 40 concurrent writers for 60 s                                                                           | no `SQLITE_BUSY` surfaced to a client; no failed acknowledged write                                            |
| AT-907 | I    | Security headers on every response                                                                       | HSTS, CSP without `unsafe-inline`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` |
| AT-908 | O    | Grep all log output from a full demo run                                                                 | no PHI, no password, no token, no key material                                                                 |
| AT-909 | I    | Boot in production with `DEMO_MODE=true`                                                                 | refuses to start, names the variable                                                                           |
| AT-910 | I    | Boot in production with the dev master key, a short `JWT_SECRET`, or no TLS and no `ALLOW_INSECURE_HTTP` | refuses to start in each case, with a distinct message                                                         |
| AT-911 | I    | `/api/health/ready` with migrations pending or the key unloaded                                          | `503` with the specific reason                                                                                 |
| AT-912 | O    | `gv subject-access --patient HOSP-LOS-2025-082`                                                          | complete, chronological access history for that patient; verifiable against the ledger                         |

---

## 10. Judge script (`npm run judge`)

Must run start to finish, unattended, against a freshly seeded demo, and print a pass/fail line per step. This is also the demo you present.

1. `npm run demo:reset` — seed and print the personas.
2. **Role separation.** Log in as RN Chioma → Ward A roster → open Amara Okafor → show HIV, genotype and pregnancy visible to the treating nurse.
3. **Redaction.** Log in as Clerk Ibrahim → open a patient in his own intake queue → show the same fields as `[RESTRICTED]` with the reason.
4. **Abuse caught.** As Ibrahim, attempt Amara Okafor (not his patient) → `403` → switch to the security console → the `RULE-ABUSE-01` CRITICAL alert is already there, live.
5. **Ward isolation.** As RN Chioma, attempt the ICU trauma patient → `403 WARD_MISMATCH` with a break-glass affordance.
6. **Break-glass.** As Dr. Adeyemi, break glass on the ICU trauma patient → chart open in under a second → red banner with the audit index → show the CMO dispatch row and the ledger entry.
7. **Tamper evidence.** Security console → **Verify chain** → `HEALTHY`. Run `npm run demo:tamper`. Verify again → `TAMPERED` at the exact index, with the row highlighted.
8. **Independent verification.** `npm run gv -- export-ledger` then `verify-ledger --file` in a separate process → same verdict without the app.
9. **Root-attacker witness.** Recompute the whole chain after the tamper → local verify is `HEALTHY` but the witness reports `WITNESS_DIVERGED`.
10. **Offline.** Toggle the outage → record vitals on two patients → show the queue → restore → sync → show the `SYNC_REPLAY` entries and `is_offline_sync=1`, chain still `HEALTHY`.
11. **Downtime SOP.** Show `docs/DOWNTIME-SOP.md` and the printable triage slip, then Batch Backfill a paper slip with its original bedside time.
12. Print a summary: entries in the ledger, alerts raised, grants issued, verification status, elapsed time.

---

## 11. Self-verification before declaring done

Run every line. All must pass.

```bash
rm -rf node_modules */node_modules && npm ci     # clean clone behaviour
npm run lint && npm run typecheck
npm test                                          # unit + integration, zero skips
npm run test:coverage                             # ≥85% overall, 100% branch on policy/ledger/crypto
npm run test:e2e                                  # playwright, zero flakes over 3 runs
npm run build
npm audit --omit=dev
docker compose up -d && ./scripts/restore-drill.sh && npm run judge
git status --porcelain                            # clean; nothing untracked that should be committed
grep -rn "TODO\|FIXME\|mock\|placeholder\|lorem" backend/src frontend/src   # zero hits in shipped paths
grep -rn "14/14 checks passing" .                  # zero hits
```

Then confirm by hand:

- [ ] `git check-ignore -v PRD.md AGENTS.md docs/ .env.example docker-compose.yml` returns nothing.
- [ ] Every claim on the landing page appears in `docs/COMPLIANCE.md`.
- [ ] No certification, accreditation or endorsement is claimed anywhere.
- [ ] `.env.example` documents every variable in §8 and contains no real secret.
- [ ] Every one of the ~120 acceptance-test ids in §9 appears in a real test title.
- [ ] README's quickstart works verbatim on a machine that has never seen this repo.
- [ ] `docs/DECISIONS.md` records every judgement call you made where this file was silent.

---

## 12. Failure playbook

| Symptom                                         | Cause                                                                                    | Fix                                                                                                                                                          |
| :---------------------------------------------- | :--------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SQLITE_BUSY` under load                        | Long-running transactions or a missing `busy_timeout`                                    | `PRAGMA busy_timeout=5000`; keep ledger appends to a single short `IMMEDIATE` transaction; never hold a transaction across an `await` of anything but the DB |
| Chain verifies locally but the witness diverges | Someone rewrote history — **or** the anchor interval elapsed during a legitimate restore | Check `chain_anchors` and the restore log. A restore writes `RESTORE_PERFORMED` and re-anchors; anything else is an incident                                 |
| Sensitive plaintext appears in AT-116           | A DTO built before redaction, or an error message echoing input                          | Redact at the serializer, never in the component; errors must never echo values                                                                              |
| `EncryptionIntegrityError` on legitimate reads  | AAD built from a different `patient_id`/column/key version than at write time            | AAD construction lives in one function, used by both paths; add a test                                                                                       |
| Flaky duty-state tests                          | Real `Date` instead of the injected `Clock`                                              | Ban `new Date()` outside `Clock`; add a lint rule                                                                                                            |
| Playwright offline tests hang                   | Heartbeat still polling a real port                                                      | Use `context.setOffline(true)` and assert on the heartbeat's own failure counter                                                                             |
| Coverage below the gate on `policy/`            | An unreachable branch or an untested `reason_code`                                       | Every `reason_code` needs a test; if a branch is genuinely unreachable, delete it                                                                            |
| `better-sqlite3` fails to build in Docker       | Missing build toolchain in the alpine stage                                              | Build in a `node:22` stage with `python3 make g++`, copy the built module into the runtime stage                                                             |

---

## 13. If you are tempted to cut scope

Cut in this order, and record it in `docs/DECISIONS.md`:

1. `UpstreamRecordSource` implementation (keep the interface + contract tests).
2. Key rotation CLI (keep versioned ciphertext so rotation stays possible).
3. MAR sign-off UI (keep the API and the schema).
4. Admin user-management UI (keep the CLI `create-user`).
5. Load-profile tests at 500 patients (keep them at 100).

**Never cut:** the policy engine, redaction, break-glass, the hash chain, the witness, the abuse engine, the offline queue, the downtime SOP, or any acceptance test that proves one of them. Those six things _are_ GridVault; everything else is furniture.
