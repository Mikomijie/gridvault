# GridVault API Specification

## 1. Overview & Global Conventions

- **Base Path:** `/api`
- **Protocol:** HTTP/1.1 or HTTP/2 over TLS 1.3 (or cleartext port 8080 in development)
- **Timezone:** Timestamps are ISO-8601 with explicit offset (`+01:00`, `Africa/Lagos`)
- **Envelope Format:**
  - Success: `{ "data": <payload>, "_meta": { "policy_version": "2.0.0", "decision_id": "...", "redactions": [...] } }`
  - Error: `{ "error": { "code": "<ERROR_CODE>", "message": "<human text>", "reason_code": "<POLICY_REASON>", "details": {...}, "request_id": "..." } }`

---

## 2. Endpoints by Domain

### 2.1 Authentication (`/api/auth`)

- `POST /api/auth/login`: Authenticate via staff credentials (`staff_id`, `password`, `terminal_id`). Returns JWT access token and sets rotating `HttpOnly; Secure; SameSite=Strict` refresh cookie.
- `POST /api/auth/refresh`: Rotates refresh token and issues fresh access token.
- `POST /api/auth/logout`: Revokes active refresh token and terminates session family.
- `POST /api/auth/unlock`: Unlocks screen from 3-minute idle lock using Quick-PIN.
- `GET /api/auth/me`: Returns authenticated user profile, duty state, and active emergency grants.
- `GET /api/auth/personas`: Demo personas (`DEMO_MODE=true` only).

### 2.2 Clinical Records (`/api/patients`)

- `GET /api/patients`: Ward roster filtered by assigned ward and role.
- `GET /api/patients/:id`: Complete patient dossier with field-level redaction applied.
- `GET /api/patients/:id/vitals`: Historical vitals observations.
- `POST /api/patients/:id/vitals`: Record vitals observation and recompute status.
- `POST /api/patients/:id/notes`: Append clinical progress note.
- `GET /api/patients/:id/mar`: Medication Administration Record entries.
- `POST /api/patients/:id/mar/:entry/sign`: Sign administration of scheduled medication.
- `PATCH /api/patients/:id`: Update patient demographics and admission status (optimistic concurrency).
- `GET /api/handover`: Export SBAR clinical handover sheet with diagnostic watermark.
- `GET /api/admissions/queue`: Intake queue for admissions clerk.

### 2.3 Emergency Clinical Override (`/api/override`)

- `POST /api/override/execute`: Break-glass execution (`patient_id`, `justification_code`, `justification_notes`, `pin`). Returns scoped 60-minute grant.
- `GET /api/override/active`: Retrieve caller's active break-glass grants.
- `POST /api/override/:id/close`: Early self-termination of grant by clinician.
- `POST /api/override/:id/revoke`: Immediate grant revocation by CMO or administrator.
- `GET /api/override`: Review queue of emergency overrides.
- `POST /api/override/:id/review`: Acknowledge or escalate override review.

### 2.4 Audit & Ledger (`/api/audit`)

- `GET /api/audit/logs`: Query audit trail (filtered by role and ward).
- `GET /api/audit/verify`: Verify integrity of SHA-256 hash chain and check against witness receipts.
- `GET /api/audit/export`: Export canonical JSONL ledger for offline verification.
- `GET /api/audit/anchors`: Witness anchor receipt history.
- `POST /api/audit/anchor`: Trigger immediate witness anchor synchronization.
- `GET /api/audit/stream`: Server-Sent Events (SSE) feed of ledger activity.

### 2.5 Abuse Detection & Ops (`/api/abuse`, `/api/sync`, `/api/health`)

- `GET /api/abuse/alerts`: Active abuse alerts feed.
- `PATCH /api/abuse/alerts/:id`: Triage or resolve alert.
- `GET /api/abuse/stream`: SSE stream of real-time security alerts.
- `POST /api/abuse/demo/clerk-probe`: Live demonstration of clerk clinical probe detection.
- `POST /api/sync/batch`: Replay offline mutations from ward terminals.
- `GET /api/sync/status`: Terminal mutation sequence tracker.
- `POST /api/sync/backfill`: Transcribe paper emergency triage slips into digital record.
- `GET /api/health/ping`: Unauthenticated liveness probe.
- `GET /api/health/ready`: System readiness check (DB, migrations, crypto key, chain head).
- `GET /api/health/metrics`: Prometheus-compatible runtime telemetry.
