# GridVault Technical Decisions Log

This document records architectural, design, and operational decisions where AGENTS.md was silent or delegated implementation details.

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
