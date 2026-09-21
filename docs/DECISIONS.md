# GridVault Technical Decisions Log

This document records architectural, design, and operational decisions where AGENTS.md was silent or delegated implementation details.

### 2026-09-21 — Fictional-data public demo deployment

- Use Vercel for the frontend and native Node 22 services on Render for API and
  witness. Updated to Free plans without persistent disks at the user's request;
  temporary data resets on spin-down, restart or redeploy. No Docker deployment is implied.
- `PUBLIC_DEMO=true` plus `DEMO_MODE=true` explicitly permits shared demo
  personas under the production runtime. Ordinary production still rejects
  demo mode; production key checks remain. First startup seeds an empty
  database, with scheduled duty extensions through 2099 for evaluator access.
  Existing stores are not reset, and demo stores must never become clinical stores.
- Keep real clocks, policy enforcement, Secure/HttpOnly/SameSite=Strict cookies,
  and server-side authorization. Proxy `/api` through the frontend origin.
- Exclude `/api` from service-worker interception, restrict asset caching, bump
  the cache version to purge the old cache, and emit `Cache-Control: no-store`
  on API responses. All frontend HTTP/SSE clients use the same base URL.
- Copy migrations and rule JSON into the compiled backend distribution and fix
  compiled startup paths. Add a demo notice, server-sourced account selectors,
  and remove unsupported certification/uptime/test-count claims from the landing page.
- See `DEPLOYMENT.md` for setup, verification, costs, and remaining limitations.
  Hosting setup and browser checks still require actual service URLs.

---

### 2026-09-13 — Phase 0: Workspace Architecture and Package Management

- **Context:** The repository contained mixed lockfiles (`pnpm-lock.yaml`, `frontend/package-lock.json`, `.pnpm-store/`) and a fake test script in root `package.json` that echoed success without assertions.
- **Decision:**
  1. Converted to a unified `npm workspaces` monorepo containing three workspaces: `backend`, `frontend`, and `witness`.
  2. Removed `pnpm-lock.yaml` and `.pnpm-store/`.
  3. Replaced root `package.json`'s fake test script with Vitest running real test suites across packages.
  4. Pinned Node engine to `>=22.0.0` in `package.json` and `22` in `.nvmrc`.
  5. Updated `.gitignore` to maintain trackability for PRD, AGENTS, docs, scripts, witness, docker-compose, and environment examples while ignoring build artifacts, local databases, and secrets.

---

### 2026-09-13 — Phase 0: Linting, AST Rules, and Security Plugins

- **Context:** Security rules non-negotiable per AGENTS.md §2 and §3 require enforcement of parameterised SQL and clean architecture boundaries (handlers call services, not repositories directly).
- **Decision:**
  1. Implemented ESLint 9 / flat config with `@typescript-eslint` parser, `eslint-plugin-security`, and custom AST rules:
     - `gridvault/no-template-literal-sql`: Prohibits template literal string interpolation in SQL statements to enforce parameterized SQL queries across repositories.
     - `gridvault/no-repository-imports-in-routes`: Prohibits files under `src/http/routes/` from directly importing repositories, enforcing service-layer encapsulation.
  2. Configured Prettier with `.editorconfig` alignment (2 spaces, LF, trim trailing whitespace).

---

### 2026-09-13 — Phase 0: Scope Bounds and Deferred Deliverables

- **Context:** AGENTS.md §7 defines a strict phase sequence. Phase 0 covers only workspace, honesty pass, tooling, CI, and scaffolding.
- **Decision:**
  1. Database migrations, crypto implementations, and repositories are explicitly scoped for Phase 1.
  2. Ledger append, verify, and tamper CLI are explicitly scoped for Phase 2.
  3. Authentication, sessions, and duty state are explicitly scoped for Phase 3.
  4. Policy engine and redaction serializers are explicitly scoped for Phase 4.
  5. Emergency override (break-glass) is explicitly scoped for Phase 5.
  6. Abuse detection engine and security console APIs are explicitly scoped for Phase 6.
  7. Offline sync, reconciliation, and IndexedDB cache are explicitly scoped for Phase 7.
  8. Full frontend integration is explicitly scoped for Phase 8.
  9. Docker production hardening and restore drill script execution are explicitly scoped for Phase 9.
  10. Out-of-scope for v2 per PRD §1.4: Billing, pharmacy inventory, lab instruments, radiology/PACS, NHIS claims, HL7/FHIR, native mobile apps, multi-tenant SaaS, biometric hardware, real SMS/email provider integration.

---

### 2026-09-14 — Phase 4: Policy Engine, Redaction, Records API, AT-101..AT-119

- **Context:** AGENTS.md §7 P4 requires the single `decide()` implementing PRD §6.1 in order with 100% branch coverage, duty-driven access, serializer-side redaction, the full PRD §12.3 surface and the `RecordSource` abstraction. Acceptance tests win over prose where they conflict (precedence rule).
- **Decision:**
  1. Step 7 (ward isolation) binds doctor/nurse only. An in-queue clerk read (AT-103, 200) and an admin read (AT-106, 200 with restrictions) force the exemption: clerks are bound by the intake queue, admins by group-level denial.
  2. Step 10 (`SENSITIVE_CLINICIAN_ONLY`) deleted. For the five spec'd roles it is subsumed by steps 4 and 6 on every path, leaving an uncoverable branch that would fail the NFR-10 100% policy gate; the failure playbook orders deletion of genuinely unreachable branches. Reintroduce if a sixth role is added.
  3. Clerk 403-vs-404: out-of-queue reads in a ward the clerk can enumerate (own ward + queue wards) are 403 `CLERK_OUT_OF_QUEUE` (AT-104, judge step 4); elsewhere 404 (AT-113, PRD §12.1). Both are logged and alerted identically.
  4. `VITALS` counts as clinical content for the clerk rule (step 4 denies VITALS/CLINICAL/SENSITIVE with `CLERK_NO_CLINICAL`); matrix "—" for clerk vitals.
  5. Admin/CMO read `DEMOGRAPHICS` as id+ward only (service projection + per-field redactions); `VITALS`/`LOGISTICS` redact silently while `CLINICAL`/`SENSITIVE` requests raise `RULE-ABUSE-05` (AT-106 "explicit sensitive request").
  6. Break-glass scope (PRD §7.4): readable all five groups, writable VITALS+CLINICAL, SENSITIVE read-only (writes denied `ROLE_CANNOT_WRITE`); the top-level decision reason under a grant is `EMERGENCY_GRANT`.
  7. Grace-window boundary is open on the left (exactly at shift end the subject is `off_duty`), pinning AT-020 (06:00 off) against AT-021 (14:15 grace).
  8. `patients.version` is the demographics OCC token only; vitals/notes/MAR writes change status but not version. Migration 003 adds `status_source`/`status_set_by` so auto-triage never overwrites a manual status (PRD §12.7).
  9. Version conflicts (409) queue a charge-nurse reconciliation task in `notification_outbox` (no reconciliation table exists in the PRD §11 schema).
  10. Sliced UUIDv7 prefixes (`slice(0, 20)`) collide within one millisecond — replaced with full UUID hex for alert and decision ids (found via AT-119).
  11. MAR sign-off and note appends use the `append` action (doctor+nurse on CLINICAL); handover requires a clinical role in the requested ward; the admissions queue adds reason code `QUEUE_ACCESS_DENIED`.
  12. AT-008/AT-009 expectations extended from `[1, 2]` to `[1, 2, 3]` for migration 003; assertions unchanged.
- **Gates at commit time:** `npm test` 105/105, `npm run lint` 0 errors, `tsc` clean, `decide.ts` + `duty.ts` 100% statements/branches/functions/lines.

### 2026-09-14 — Phase 5: Break-Glass Override, AT-201..AT-212

- **Context:** AGENTS.md §7 P5 requires PIN-verified scoped grants in one transaction with outbox dispatch, lifecycle (expiry/close/revoke/review) and ≤400 ms p95 server-side.
- **Decision:**
  1. Execute writes `EMERGENCY_OVERRIDE_REQUESTED` then `EMERGENCY_OVERRIDE_GRANTED` plus the grant row plus two HIGH outbox rows (CMO staff id, `charge_nurse:<ward>`) in one transaction; delivery is a separate worker step that can never block care (AT-208).
  2. Grants are resolved server-side per request (`grantFor`); nothing grant-shaped enters the JWT.
  3. Expired grants answer 410 `GRANT_EXPIRED` (not 403) via lazy expiry in the records deny path; the transition writes `EMERGENCY_OVERRIDE_CLOSED` with `reason: expired` because §8.1 has no EXPIRED action.
  4. Logout closes all ACTIVE grants (PRD §7.2 lifecycle).
  5. Override PINs throttle per-staff in memory (3 strikes → 15 min, 429); IP lockout never applies to break-glass (PRD §6.6).
  6. Frequency spikes (2nd grant in 60 min) succeed with `RULE-ABUSE-04` CRITICAL and an escalated dispatch line (AT-212).
  7. Justification codes live in `backend/config/justifications.json`, validated at boot; `OTHER` needs ≥20 chars.
- **Gates at commit time:** `npm test` 117/117, lint 0 errors, `tsc` clean.

### 2026-09-13 — Phase 2: Tamper-Evident Ledger, Anchor Witness, and AT-301..AT-315

- **Context:** AGENTS.md §7 P2 requires the append path, streaming verifier, Ed25519-anchored witness, JSONL export with standalone file verification, and the `demo:tamper` CLI, proven by acceptance tests AT-301..AT-315.
- **Decision:**
  1. Ledger entry hash is SHA-256 over a canonical-JSON array payload with the `gridvault.audit.v2` domain separator as element zero (replacing the v1 pipe-delimited format, which admitted delimiter-confusion forgeries); genesis `prev_hash` is 64 zeros.
  2. `appendLedgerEntry` runs inside `BEGIN IMMEDIATE` (joining an ambient transaction when one exists), re-reading the chain head under the write lock so concurrent ward terminals serialize without forking; unknown actions and unserializable details fail closed via `LedgerError`.
  3. `verifyLedger` is pure and streaming (O(1) memory) in three phases — structure (density + timestamp monotonicity, so reordered timestamps report `TIMESTAMP_REGRESSION` before hashes can mask them), chain (linkage then recomputation, first offending index wins), witness (newest independent receipt must still match the local entry, else `WITNESS_DIVERGED`).
  4. Anchor receipts are signed Ed25519 (`ed25519:<base64>`) over a dedicated `gridvault.anchor.v1` canonical payload; delivery failure records `PENDING` and never blocks clinical writes; the file verifier derives witness views from exported anchor lines only, never from a database or the network.
  5. `demoTamper` simulates a host attacker (drops the append-only triggers, rewrites one allowlisted cell via direct file access, reinstalls the triggers byte-identical) and refuses `NODE_ENV=production` without the explicit corruption-acknowledgement flag; there is no HTTP path to it.
  6. Test inventory: AT-301/AT-302 in `backend/test/unit/ledger-hash.test.ts`; AT-303..AT-311 and AT-315 in `backend/test/integration/ledger.test.ts`; AT-312..AT-314 in `backend/test/integration/ledger-operational.test.ts` (real `gv` CLI child processes and the live witness child process over HTTP). Defensive branch pins live in `backend/test/unit/ledger-branches.test.ts` (no AT ids).
  7. Gates at commit time: `npm test` 61/61 passing (11 files), `npm run lint` 0 errors (8 pre-existing `security/detect-non-literal-fs-filename` warnings on operator file paths), `npm run typecheck` clean (backend + witness), `npm run test:coverage` exit 0 (no NFR-10 gate wired yet; that lands in Phase 9).

### 2026-09-14 — Phase 6: Abuse Engine API, Alert Lifecycle, SSE, Demo Probe, AT-401..409

- **Context:** AGENTS.md P6 requires RULE-ABUSE-01..09 as individual tested modules with config-driven thresholds, synchronous blocking evaluation, alert lifecycle, self-resolution prohibition, SSE streams, and a genuine demo probe.
- **Decision:**
  1. Rules 01-09 already existed as pure predicates in `src/abuse/rules/`; this phase added the HTTP surface (`src/http/routes/abuse.ts`): `GET /alerts` (admin/cmo only), `PATCH /alerts/:id` (forward-only FLAGGED->INVESTIGATING->RESOLVED, note required, self-resolution 403 CANNOT_RESOLVE_OWN_ALERT, ABUSE_ALERT_RESOLVED ledger entry), `GET /stream` (DB-backed 500 ms short-poll SSE, auth checked at connect, alert metadata only), `POST /demo/clerk-probe` (DEMO_MODE only; builds a server-side clerk subject with on_duty forced to isolate the queue control, calls RecordsService.readDossier through decide()->deny->obligations, returns denial + newest RULE-ABUSE-01 alert with genuine=decision_id match, never a fabricated row).
  2. `GET /api/audit/stream` added symmetrically (ledger-read privilege via ledgerLogs check, replay-20 + 500 ms poll on log_index).
  3. Boot now fails loudly on invalid `config/abuse-rules.json` (index.ts calls loadAbuseRules + loadJustifications; AT-409 asserts the named threshold).
  4. Metrics: raiseAbuseAlert records per-rule counters; override execute records break-glass; 403s record denials by reason_code; /api/health/metrics renders Prometheus text with per-route p95, denials, alerts, verify status, outbox depth, anchor lag.
  5. Logger: pino with redaction of PHI/credential/key paths (AT-908 hygiene).
  6. AT-407 isolation: the bulk probe assigns the doctor a consulting care assignment on every patient first, otherwise RULE-ABUSE-07 sweep blocks at 5 distinct sensitive reads and the bulk count never reaches 21. Engine throttle state is reset at the test start (module-global lastReadMs map).
  7. AT-408 counts 2 ABUSE_ALERT_RESOLVED entries (INVESTIGATING + RESOLVED each write one).
- **Gates at commit time:** abuse.test.ts 10/10, sync unaffected.

### 2026-09-14 — Phase 7: Offline Sync Batch + Paper Backfill, AT-504..509/513

- **Context:** AGENTS.md P7 backend requires POST /api/sync/batch (idempotent, device_seq ordered, additive merges, 409 conflicts, SYNC_GAP_DETECTED, clock-skew flags, SYNC_REPLAY entries), POST /api/sync/backfill (dual timestamps, transcriber), GET /api/sync/status.
- **Decision:**
  1. New `src/sync/service.ts` (SyncService.applyBatch): <=100 mutations, sort by (device_id, device_seq), gap warnings computed pre-transaction (against stored max + intra-batch), whole batch in ONE transaction (kill -9 applies nothing; conflicts recorded as per-mutation conflict results with charge-nurse outbox task, never a rollback of siblings), idempotency by client_mutation_id (duplicates_ignored, zero new rows/ledger on replay), VITALS validation mirrors live ranges (422 INVALID_VITALS, field names only), policy write-check on replay (offline capture cannot launder unauthorized writes), PAPER_BACKFILL writes source=paper_backfill + BACKFILL_PAPER_SLIP with transcriber=caller, PATIENT_PATCH uses patients.version OCC (409 detail carries base_version+current_version).
  2. `POST /api/sync/backfill` restricted to non-clerk roles (403 CLERK_NO_CLINICAL); slips map to PAPER_BACKFILL mutations with captured_at_source=user_entered.
  3. Response shape `{processed, duplicates_ignored, conflicts, audit_entries_created, warnings[], results[]}`; warnings carry code SYNC_GAP_DETECTED + device + missing range text.
- **Gates at commit time:** sync.test.ts 7/7.

### 2026-09-14 — Cross-cutting: CLI, Judge, Observability

- **Context:** AGENTS.md P6 CLI list requires seed, migrate, verify-ledger, export-ledger, anchor, backup, restore, rotate-key, subject-access, create-user, demo:tamper; section 10 requires `npm run judge`.
- **Decision:**
  1. Added `backup` (VACUUM INTO + sha256 manifest + BACKUP_CREATED chain entry), `restore --file` (manifest verify -> scratch copy -> chain verify -> swap + RESTORE_PERFORMED), `rotate-key --new-key` (decrypt-old/encrypt-new per row, key_version+1, one transaction), `subject-access --patient` (chronological patient-scoped ledger dump + chain status, AT-912), `create-user` (argon2id hashes computed before the transaction, USER_CREATED entry, no secret in ledger).
  2. `scripts/judge.ts` runs the 12-step walkthrough against an isolated seeded stack and prints PASS/FAIL per step plus a summary (entries/alerts/grants/elapsed); step 9 simulates the root attacker by recomputing the chain and comparing against an independent receipt (WITNESS_DIVERGED).
  3. docs/API.md and docs/OPERATIONS.md already documented the abuse/sync/health/CLI surface; no landing-page claim changes needed (no certification language present).

### 2026-09-14 — NFR-10 coverage gate + dead-predicate wiring (Phases 6/7 hardening)

- **Context:** Coverage showed 100%-branch shortfalls on gate paths and four rule predicate modules (01/04/08/09) with 0% statements — dead code while the engine inlined their logic, contradicting the P6 "individually-tested modules" DoD.
- **Decision:**
  1. Wired each orphan predicate into its call site with identical behavior: `isClerkProbe` gates decide() step 5 (arm 1; arm 2 stays redact-only at step 4 by design — dossier reads request every group, so alerting there would fire CRITICAL on legitimate in-queue clerk work); `isFrequencySpike` replaces the hardcoded `>= 1` in override/service.ts, with count/window now drawn from abuse-rules.json via new service options; `shouldLockout` and `isReuseOfRotatedToken` replace the inline comparisons in auth/service.ts. Direct unit tests pin all nine predicate boundaries (`test/unit/abuse-rules.test.ts`).
  2. Deleted three provably unreachable branches per the failure playbook (never silently disabled rules — these are the opposite: code that could never run): the `try/catch` around `Buffer.from(.., 'base64')` in `parseNodeSigningKey` (never throws for string input; empty/malformed keys still fail on the length and key-type checks), the GCM tag-length guard in `encryptField` (fixed 16 bytes without an explicit authTagLength; tampering stays caught by GCM auth on decrypt, AT-007), and the `?? headHash` fallback in `exportLedger` (the line is serialized two statements up and always carries the hash).
  3. Simplified two cosmetic-only fallbacks whose false arms were unreachable through any real scenario (Node 22's DOMException now subclasses Error, so fetch rejections always take the message arm): uniform `String(error)` in the witness-unreachable paths and `String(key.asymmetricKeyType)` in the key-type message. Messages stay loud; no test pinned the old text.
  4. Kept the `hour === 24` midnight normalization and the Intl `get()` throw in clock.ts despite this toolchain's ICU never taking them: they are environment-dependent correctness (other ICU builds emit `24:00:00`), not dead code. They cost only the global gate, which passes regardless.
  5. Coverage scope (`vitest.config.ts`): backend/src + witness/src only. Excluded: dist/ and frontend build output (regenerable artefacts), frontend/** (no unit harness yet; covered by the P8 Playwright suite and AT-624/625), backend/src/cli/** (exercised through child processes by AT-313/314/912 and restore-drill.sh, which v8 cannot attribute), backend/src/index.ts (bootstrap), scripts/** (exercised by the section-11 runs). The 100%-branch rule for policy/, ledger/, crypto/ is enforced by scripts/coverage-gate.mjs because vitest supports only global thresholds.
  6. Operational tests added: AT-514 (batch atomicity both ways — a failing mutation rolls back the transaction; SIGKILL to the live server's process group leaves all-or-nothing state that replays to completion with a HEALTHY chain; tsx orphans require detached process-group kills, asserted by port silence), AT-908 (shipped pino redaction config plus stdout grep over a full demo run), AT-912 (subject-access chronology + hash verifiability). restore-drill.sh is a real AT-905 drill (backup → destroy → restore → manifest/HEALTHY/count/sentinel checks) against an isolated temp DB.
- **Gates at commit time:** `npm test` 146/146 rising to 170+; `npm run test:coverage` exits 0 (92.47% lines / 87.06% branch globally; per-path gate PASS); lint 0 errors; typecheck clean.

### 2026-09-14 — Phase 8/9 hardening pass: shell resilience, CI parity, load test, one real bug

- **Context:** An audit against AGENTS.md found P0–P7 and most of P8 already implemented and green (186/186 unit+integration, lint/typecheck clean), but several concrete DoD items were missing or unverified: AT-619 (focus trap), AT-622 (error boundary), AT-623 (service worker offline shell), the CI pipeline's E2E/audit/coverage gates (§3), and AT-901/AT-906 (load test). This entry covers what was closed and two judgment calls where AGENTS.md's literal wording conflicts with an already-shipped, tested security decision.
- **Decision:**
  1. **CI (§3):** added Playwright install + `npm run test:e2e`, `npm audit --omit=dev`, and `npm run test:coverage` steps to `.github/workflows/ci.yml` after the existing install→lint→typecheck→unit/integration→build steps, matching the exact gate order specified.
  2. **AT-622 (error boundary):** added `frontend/src/components/ErrorBoundary.jsx` (class component, `getDerivedStateFromError`) wrapping the router root in `App.jsx` — the only mechanism that stops a true render crash from producing a white screen; DashboardPage's existing `loadError`/Retry UI already handled a handled fetch failure gracefully and needed no change.
  3. **AT-619 (focus trap):** `BreakGlassModal` now traps Tab/Shift+Tab within the dialog (`getFocusable()` excludes disabled elements, since the Confirm button starts disabled with no PIN yet — the pre-existing `confirmRef.current?.focus()` silently no-opped on a disabled element, so autofocus now targets the first enabled field instead). Removed the modal's own dead `aria-live` announcement: the caller (`PatientDossierPage.confirmOverride`) sets `modalOpen=false` synchronously once the grant succeeds and only awaits `refreshMe()`/`load()` afterward, so anything the modal set post-await was applied to an already-unmounted instance and could never render. `EmergencyBanner`'s own `role="alert"` (mounted by the parent, which stays mounted) is the announcement that actually reaches the screen reader; AT-619 now asserts against that.
  4. **AT-623 (offline cold boot) — architecture conflict, resolved conservatively:** built a service worker (`frontend/public/sw.js`, not `src/sw.js` as AGENTS.md §4 lists it — see note below) that precaches `/` and `/index.html` and opportunistically caches same-origin GETs, plus an encrypted roster cache (`frontend/src/lib/cache.js`, AES-GCM with a non-extractable IndexedDB-resident key, matching the ciphertext-only rule already applied to the offline mutation queue). Empirically, a genuine cold reboot while the network is down **cannot** reach an authenticated dashboard under this app's existing (correct, tested) security model: access tokens live only in memory (AT-627) and every reload requires `POST /api/auth/refresh` to mint a new one, which cannot succeed with no network. Rendering a previously-cached roster without that round trip would show one staff member's PHI to whoever next reboots a shared ward terminal — a confidentiality break that Rule 3/5 (deny-by-default, never trust the client for authz) rank above offline convenience. Resolution: the service worker demonstrably serves the app shell offline (login page renders instead of a browser error page — `frontend/test/e2e/offline-shell.spec.ts`, run against a **production preview build**, new `chromium-shell` Playwright project on :4173, because the dev server's dozens of unbundled ES module requests predate the worker's own registration and were never a realistic precache target); the encrypted roster cache serves its real purpose one layer up — an already-authenticated session whose roster call starts failing mid-shift (backend degraded, not a reload) falls back to the last-seen roster with a visible "showing cached" notice (`frontend/test/e2e/resilience.spec.ts`). Full authenticated-cold-boot-while-offline is out of scope until there is a secure local-reauthentication story (e.g., an offline PIN check against a locally-held credential) — not attempted here.
  5. **`sw.js` location:** placed at `frontend/public/sw.js`, not `frontend/src/sw.js`. Vite's `assetsInlineLimit` (default 4 KB) base64-inlines a `new URL('./sw.js', import.meta.url)` reference as a `data:` URL, and `navigator.serviceWorker.register()` rejects `data:` scripts outright (`SecurityError`) — confirmed by building and inspecting `dist/`. `public/` files are copied verbatim and always resolve to a real same-origin path in both dev and prod.
  6. **Real bug found and fixed:** `GET /api/handover`'s query schema only declared `ward`, so Zod silently stripped the `terminal_id` the frontend already sent, and the route hardcoded `terminal_id: null` into `service.handover(...)` regardless. The watermark always read "unknown-terminal" instead of the real `ward-terminal-XXXXXXXX` id — AT-617 failed consistently (verified on unmodified `main` via `git stash`, not a flake introduced here). Fixed by adding `terminal_id` to `handoverQuerySchema` and threading it through.
  7. **Test-state leak found and fixed:** the new AT-619 spec opened a break-glass grant on `GV-9042`/`HOSP-LOS-2025-081` and never closed it; because the whole Playwright run shares one seeded backend for its lifetime, the dangling `ACTIVE` grant turned AT-627's expected `WARD_MISMATCH` into a `200` for every spec file that ran afterward. Fixed by ending the grant at the end of the AT-619 test, matching the existing AT-608/609 pattern.
  8. **AT-901/AT-906 (`scripts/load-test.ts`, new `npm run load-test`):** seeds the 500-patient/~50,000-entry `load` profile into a real WAL-mode file (not `:memory:`), serves it over an actual `http.Server`, and drives roster/dossier/vitals-write with 40-way bounded concurrency plus a 60 s/40-writer sustained phase, writing `docs/load-test-report.md`. Uses a **fixed** clock (`2026-09-13T10:00:00Z`, matching the existing `TEST_CLOCK` convention) — the first run against `systemClock` put every persona off-duty and returned 100% `403`s, which would otherwise have been a false pass/fail depending on wall-clock time of day. Read benchmarks target one fixed patient per persona (repeated reads, not distinct-patient enumeration) specifically so the benchmark itself does not trip `RULE-ABUSE-06` (bulk enumeration) or `RULE-ABUSE-07` — an artifact of the harness, not a claim about real usage.
     - **Result, reported honestly:** AT-906 passes cleanly (46,553+ writes over 60 s at 40 concurrent writers, zero failures, no `SQLITE_BUSY`, chain `HEALTHY` afterward) — the property the failure playbook actually worries about. Dossier (p95 ≈72 ms/200 ms budget) and vitals-write (p95 ≈113 ms/120 ms budget) meet NFR-1. **Roster does not** (p95 ≈275 ms against a 150 ms budget) under a synthetic 40-simultaneous-burst pattern. Root cause: `better-sqlite3` is synchronous and Node is single-threaded (a deliberate choice — "removes a whole class of race conditions in the ledger append path"), so 40 literally-simultaneous requests serialize on one thread regardless of SQLite's own WAL concurrency; the roster response is also the largest payload of the three (up to ~83 rows per ward) with a `VIEW_ROSTER` ledger append on every read. This is a genuine, unresolved finding, not a fabricated pass — logged here per Rule 1 rather than adjusted until green. A real fix (lighter roster DTO, pagination, or moving the read-audit ledger append off the request's critical path — legitimate for a pure read with no accompanying state change, unlike the write path Convention in §5) is out of scope for this pass; the security-critical paths (ledger, policy, crypto) it would touch are exactly the ones already at 100% branch coverage and were left alone rather than risked for a latency micro-optimization.
  9. **`test:coverage` after this pass:** 92.39% lines / 86.98% branch globally; `policy/`, `ledger/`, `crypto/` still 100% branch (enforced by `scripts/coverage-gate.mjs`). Full `npm test`: 186/186. Full Playwright run (both projects, `chromium` + `chromium-shell`): 30/30.
  10. **Still open / consciously not attempted this pass:** full i18n migration of `frontend/src/pages/LandingPage.jsx` (671 lines of marketing copy, currently zero `en.json` references) and the remaining partially-hardcoded strings across other pages — AT-628 needs a scan step plus the actual migration, and a mechanical rewrite of that scale was judged higher-risk-than-value against the remaining session budget compared to the concrete, verifiable fixes above; AT-902 (`docker compose up` on a clean machine, ≤90 s) — no Docker daemon available in this environment to verify live, though the Dockerfiles/compose file are unchanged and structurally complete from Phase 9's original pass.
- **Gates at commit time:** `npm test` 186/186; `npm run lint` 0 errors (16 pre-existing warnings, unchanged); `npm run typecheck` clean; `npm run test:coverage` exits 0; `npx playwright test` 30/30 across both projects; `npm run load-test` reports AT-906/dossier/vitals PASS, roster p95 FAIL (see above).
