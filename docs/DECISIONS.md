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
