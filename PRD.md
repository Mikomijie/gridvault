# GridVault — Product Requirements Document

**Project:** GridVault — Sovereign Clinical Records & Bedside Access Vault
**Track:** C1 — Safe Access to Patient Records (Health & Medical Systems)
**Document version:** 2.0
**Status:** Approved for build. No open questions block implementation.
**Supersedes:** PRD v1.0
**Companion document:** [AGENTS.md](AGENTS.md) — the build manual and acceptance-test suite. This PRD says _what_ and _why_; AGENTS.md says _how_, _in what order_, and _how it is proven_.

> **Rule of precedence.** If this PRD and AGENTS.md disagree on a factual detail (a table name, an env var, a status code), AGENTS.md wins and this PRD is amended. If either disagrees with a written acceptance test, the acceptance test wins.

---

## 0. What changed in v2, and why

v1 was a good specification of a demo. v2 is a specification of a system that can be deployed in a ward. The substantive changes:

| #   | Change                                                                                                                                                                                                                                    | Reason                                                                                                                                                                                                         |
| :-- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Deny-by-default authorization expressed as a single formal decision function, evaluated in one place, with an explicit decision trace attached to every audit entry.                                                                      | v1 scattered rules across a matrix, a rules table and prose. Three sources of truth for an access decision is how access-control bugs ship.                                                                    |
| 2   | Canonical JSON serialization + domain separation for the hash chain; chain verification also available as an offline CLI over an exported ledger.                                                                                         | v1's `a\|b\|c` concatenation is ambiguous — a `\|` inside `details` lets an attacker forge a colliding payload. A verifier that only runs inside the app being audited is not independent.                     |
| 3   | External witness anchoring promoted from "nice to have" to a first-class, testable requirement with a defined receipt format and a divergence alarm.                                                                                      | Hash chaining alone does not stop an attacker with root, who can rewrite the table _and_ recompute every hash. The brief explicitly asks for a log that stays trustworthy when the main system is compromised. |
| 4   | `POST /api/audit/simulate-tamper` is removed from the production surface. Tampering is demonstrated by a signed CLI (`npm run demo:tamper`) that writes directly to the database file, exactly as a real attacker with host access would. | Shipping an authenticated HTTP endpoint whose documented purpose is corrupting the audit ledger destroys the control it is meant to showcase.                                                                  |
| 5   | AES-256-GCM column encryption binds ciphertext to the row with AAD (`patient_id` + column name + key version).                                                                                                                            | Without AAD an attacker with DB write access can swap Patient X's HIV ciphertext onto Patient Y's row without breaking decryption.                                                                             |
| 6   | Break-glass produces a _scoped_ grant (one staff, one patient, one hour, one purpose, revocable) rather than a session-wide unlock.                                                                                                       | v1's "temporary scoped token" was named but not scoped. A break-glass on one trauma patient must not open the rest of the ward.                                                                                |
| 7   | Clerk legitimacy is modelled explicitly with an `admissions_queue` / `care_assignments` relation instead of being asserted in prose.                                                                                                      | `RULE-ABUSE-01` in v1 could not actually be evaluated: nothing in the schema said which patients a clerk _is_ allowed to touch.                                                                                |
| 8   | Offline mutations carry a client-generated `client_mutation_id` (idempotency key) and a per-device monotonic sequence; reconciliation is revision-based and additive, never clock-based.                                                  | Ward terminals ride power cuts; their clocks drift. "Latest timestamp wins" silently loses vitals.                                                                                                             |
| 9   | Device-side PHI cache has an explicit lifecycle: encrypted at rest in IndexedDB, purged on logout, on hard lock expiry, and after 24h.                                                                                                    | v1 cached 20–50 patient dossiers on a shared ward tablet with no stated erasure rule. That is a data-leak surface introduced by the resilience feature.                                                        |
| 10  | Shift boundaries define the midnight-wrapping night shift, a 30-minute handover grace window, and an explicit `after-hours` decision instead of a hard block.                                                                             | 22:00–06:00 is not a simple `start <= t <= end` comparison, and a nurse who stays 10 minutes past the end of a shift must not be locked out of a patient mid-observation.                                      |
| 11  | Every requirement is traceable: brief bullet → PRD section → acceptance-test ID.                                                                                                                                                          | The brief lists five deliverables. Each must be demonstrably met, not approximately met.                                                                                                                       |
| 12  | Regulatory references updated: the Nigeria Data Protection Act (NDPA) 2023 is the governing statute; NDPR 2019 is retained as the subsidiary regulation.                                                                                  | The product makes compliance claims on its landing page. Those claims must name the right law.                                                                                                                 |
| 13  | Non-functional requirements (latency budgets, availability, accessibility, browser matrix, observability, backup/restore drill) are stated as numbers that a test can check.                                                              | "Production grade" is unfalsifiable unless the bar is a number.                                                                                                                                                |
| 14  | The placeholder root `npm test` script that prints `14/14 checks passing` and exits 0 is designated a defect to be removed in Phase 0.                                                                                                    | A test command that always passes is worse than no test command: it converts an unknown into a false assurance.                                                                                                |

---

## 1. Context and problem statement

### 1.1 Operating environment

Nigerian secondary and tertiary facilities — teaching hospitals, specialist centres, state general hospitals — are moving case files from paper to computers faster than they are securing them. Six conditions define the environment GridVault must survive:

1. **All-or-nothing access.** Typical installations have no role or ward segmentation. A records clerk, a visiting specialist, an administrative officer and a departing intern can each open a complete patient history.
2. **High-stigma attributes in every file.** HIV serostatus, genotype (Hb AA / AS / SS / SC), psychiatric notes and pregnancy records sit in the same record as a bed number. Disclosure costs people marriages, jobs, custody and physical safety.
3. **Mutable audit trails.** Where logs exist they live on the same host as the application database, unprotected. Anyone who reaches administrative rights — an attacker or a curious staff member — can `UPDATE` or `DELETE` the row that records their own snooping.
4. **Shared devices, rotating shifts.** Wards run 8-hour rotations on shared desktops and tablets. Account provisioning takes days, so staff share one live login. Attribution collapses.
5. **Power and network are not assumptions.** Grid drops, generator changeovers and modem reboots are weekly, often daily. Terminals on UPS stay up while the network does not. A doctor in a resuscitation cannot be stopped by a login screen or a spinner.
6. **The records system was bought, not built.** Most hospitals cannot replace their proprietary EMR. GridVault must work both as a standalone sovereign EMR _and_ as an enforcing proxy in front of an existing database.

### 1.2 Traceability to the track brief

| Brief deliverable                                                                                                       | Where it is specified                                                  | Proven by                                  |
| :---------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------- | :----------------------------------------- |
| A prototype records system, or a layer over a simple one, where what a user sees depends on role, ward and current duty | §6 Access control model; §12.3 Records API                             | AT-101 … AT-118                            |
| A working emergency override that grants access immediately and makes that access impossible to hide                    | §7 Break-glass                                                         | AT-201 … AT-212                            |
| An access log that stays trustworthy even if the main system is compromised                                             | §8 Tamper-evident ledger (chain + external witness + offline verifier) | AT-301 … AT-315                            |
| A demonstration of at least one abuse case being caught — a clerk opening records of patients they never treated        | §9 Abuse detection                                                     | AT-401 … AT-409                            |
| A short answer for what staff do when the system is down or offline                                                     | §10 Offline resilience and downtime protocol; `docs/DOWNTIME-SOP.md`   | AT-501 … AT-512                            |
| Free tools: any web framework, SQLite/Postgres, Synthea-style synthetic data, hash chaining                             | §4 Stack; §16 Synthetic data                                           | Build succeeds with zero paid dependencies |

### 1.3 Goals

- **G1.** Enforce deny-by-default access control over three dimensions — role, assigned ward, active duty — with field-level redaction of high-stigma data at the serialization boundary.
- **G2.** Make emergency access instant (≤ 2 interactions, ≤ 1 s to unlocked chart) and impossible to conceal.
- **G3.** Make the access log tamper-**evident** under an attacker who holds the database file, and tamper-**detectable** under an attacker who also holds the application binary, via an external witness.
- **G4.** Catch and display at least one class of insider abuse in real time, with the offending request blocked, not merely noted.
- **G5.** Keep a ward terminal clinically useful with no network and no upstream server, and reconcile deterministically on reconnect without losing a single observation.
- **G6.** Ship something a hospital IT officer with one laptop can deploy: one `docker compose up`, no cloud account, no licence key.

### 1.4 Non-goals (v2)

Stated so no one builds them by accident:

- Billing, pharmacy inventory, laboratory instrument integration, radiology/PACS, insurance (NHIS) claims.
- HL7 v2 / FHIR interoperability. (The proxy-mode adapter interface is specified in §4.3 but only the standalone adapter is implemented.)
- Native mobile applications. The ward terminal is a responsive web app; it is installable as a PWA.
- Multi-tenant SaaS. One deployment serves one facility.
- Biometric authentication hardware. The UI accommodates a badge/PIN flow; only PIN is implemented.
- Real SMS/e-mail delivery to a CMO's phone. Dispatch is implemented against a pluggable notifier whose default driver is a durable local outbox (§7.5).

### 1.5 Success metrics

| Metric                                                                 | Target                                                                     | Measured by         |
| :--------------------------------------------------------------------- | :------------------------------------------------------------------------- | :------------------ |
| Unauthorized field exposure in automated testing                       | 0 across the full RBAC matrix (5 principals × 4 patients × 9 field groups) | AT-118 matrix sweep |
| Time from break-glass click to readable chart                          | p95 ≤ 1000 ms, ≤ 2 interactions                                            | AT-204              |
| Break-glass events with a complete, verifiable audit + dispatch record | 100%                                                                       | AT-206, AT-207      |
| Ledger verification throughput                                         | ≥ 10,000 entries/s single core; 50,000-entry ledger verified in < 5 s      | AT-312              |
| Tamper localisation accuracy                                           | Exact `broken_at_index` on single-row edit, insert, delete and reorder     | AT-305 … AT-308     |
| Offline observations lost on reconnect                                 | 0, across 3 devices × 10 mutations with duplicate replay                   | AT-505, AT-508      |
| API p95 latency, ward roster, 500 patients, local hardware             | ≤ 150 ms                                                                   | AT-901              |
| Accessibility                                                          | WCAG 2.2 AA on landing, login, dashboard, dossier, break-glass modal       | AT-903              |

---

## 2. Personas

| ID  | Persona             | Staff ID  | Role     | Ward             | Shift     | What they must be able to do                                                             | What they must never see                                                         |
| :-- | :------------------ | :-------- | :------- | :--------------- | :-------- | :--------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------- |
| P1  | Dr. Olumide Adeyemi | `GV-9042` | `doctor` | `icu`            | morning   | Full clinical record for ICU patients; break-glass into any ward; write notes and orders | Nothing in ICU; everything outside ICU until break-glass                         |
| P2  | RN Chioma Okonkwo   | `SN-7742` | `nurse`  | `ward_a`         | morning   | Ward A roster, vitals entry, MAR sign-off, SBAR handover, offline capture                | Any Ward B / ICU / Maternity record; psychiatric notes are read-only             |
| P3  | Ibrahim Danjuma     | `RC-1029` | `clerk`  | `admissions`     | afternoon | Demographics and admission logistics **only**, and only for patients in his intake queue | Every clinical field, for every patient, always — including his own intake queue |
| P4  | Kemi Balogun        | `AD-0012` | `admin`  | `administration` | morning   | User administration, ledger inspection, chain verification, abuse alert triage, backups  | Every clinical field and every high-stigma field, for every patient, always      |
| P5  | Dr. Ngozi Eze       | `GV-9101` | `cmo`    | `administration` | morning   | Everything an admin sees, plus break-glass review and acknowledgement                    | Clinical fields, unless she performs her own break-glass as a clinician          |

**Design decision (explicit and load-bearing): the system administrator is not a clinician.** `admin` has full control of the _system_ and zero access to clinical _content_. This is the single most important departure from how the hospital's existing software behaves, and it is what makes the audit log meaningful — the person who can reach the server is not the person who can read the HIV column, and if they try, §9's rules fire.

---

## 3. Product scope: the five surfaces

1. **Ward terminal** (`/dashboard`) — roster, dossier, vitals, MAR, notes, handover, offline mode, break-glass. Used by P1, P2.
2. **Admissions desk** (`/dashboard` in clerk mode) — intake queue, demographics, bed allocation. Used by P3.
3. **Security console** (`/dashboard/security`) — ledger inspector, chain verifier, witness status, abuse alerts, override review. Used by P4, P5.
4. **Public site** (`/`) — the existing landing page, aligned to claims this document can actually back.
5. **Operator CLI** (`npm run gv -- <command>`) — seed, verify, export, anchor, backup, restore, tamper-demo. Used by hospital IT and by judges who want to check the maths outside the app.

---

## 4. Architecture

### 4.1 Deployment topology

```
                         ┌──────────────────────────────────────────┐
  Ward A tablet ────┐    │  WARD EDGE NODE  (mini-PC / RPi 4, UPS)   │
  Ward A desktop ───┼───►│  ┌────────────────────────────────────┐  │
  ICU terminal ─────┘    │  │ nginx  :443  TLS 1.3, HSTS, CSP    │  │
      (LAN, no internet  │  ├────────────────────────────────────┤  │
       required)         │  │ gridvault-api  :8080  Node 22      │  │
                         │  │  · policy engine (deny by default) │  │
                         │  │  · redaction serializer            │  │
                         │  │  · break-glass coordinator         │  │
                         │  │  · ledger service (SHA-256 chain)  │  │
                         │  │  · abuse rule engine               │  │
                         │  │  · sync replay + reconciliation    │  │
                         │  │  · notifier outbox                 │  │
                         │  ├────────────────────────────────────┤  │
                         │  │ SQLite (WAL)  /data/gridvault.db   │  │
                         │  │ backups/      *.db + manifest      │  │
                         │  └────────────────────────────────────┘  │
                         └───────────────┬──────────────────────────┘
                                         │  outbound-only, opportunistic
                                         │  HTTPS, signed anchor receipts
                                         ▼
                         ┌──────────────────────────────────────────┐
                         │  WITNESS NODE (separate host/custody)    │
                         │  append-only anchor store; independent   │
                         │  credentials; no read access to PHI      │
                         └──────────────────────────────────────────┘
```

**Trust boundaries.** (B1) browser ↔ API: hostile, authenticate and authorize everything. (B2) API ↔ SQLite: the API is the only writer of clinical tables; SQLite triggers defend the ledger even against the API. (B3) edge node ↔ witness: the witness trusts nothing from the node except signed receipts and never returns PHI. (B4) ward LAN ↔ internet: outbound-only; the system is fully functional with B4 severed.

### 4.2 Why SQLite, not Postgres

A ward edge node has no DBA, restarts on generator changeover, and must survive a hard power cut mid-write. SQLite in WAL mode with `synchronous=NORMAL` gives crash-safe single-file durability, a trivially copyable backup (`VACUUM INTO`), and zero operational surface. The data access layer is written behind a `Repository` interface so a Postgres driver can be added for a multi-ward central node without touching business logic. Expected ceiling: ~500 inpatients and ~5,000 audit writes/day per node, two orders of magnitude below SQLite's limits.

### 4.3 Standalone mode and proxy mode

GridVault ships one `RecordSource` interface with two implementations:

- `SqliteRecordSource` (**implemented in v2**) — GridVault is the system of record.
- `UpstreamRecordSource` (**interface + contract tests only in v2**) — GridVault fronts an existing hospital EMR, reads through to it, and applies policy, redaction, logging and break-glass on the way out. This is the answer to "you usually cannot replace the records system".

Both implementations satisfy the same contract test suite (AT-119), so a facility's choice of mode never changes the security properties.

### 4.4 Technology (pinned; rationale in AGENTS.md §3)

| Layer     | Choice                                                                                   |
| :-------- | :--------------------------------------------------------------------------------------- |
| Runtime   | Node.js 22 LTS                                                                           |
| API       | TypeScript 5 (strict), Express 4, Zod 3, better-sqlite3 11                               |
| Crypto    | Node `crypto` (SHA-256, AES-256-GCM, Ed25519), `argon2` for passwords                    |
| Auth      | JWT (HS256 access, 15 min) + rotating refresh cookie (HttpOnly, Secure, SameSite=Strict) |
| Frontend  | React 18, Vite 4, Tailwind 3, React Router 6 (existing code preserved)                   |
| Offline   | IndexedDB via `idb`, service worker, Web Crypto for cache encryption                     |
| Tests     | Vitest + Supertest (API), Vitest + Testing Library (UI), Playwright (E2E)                |
| Packaging | Docker multi-stage, docker compose, nginx alpine                                         |
| Cost      | Zero licensed dependencies. Everything above is OSS.                                     |

---

## 5. Threat model

Assets: **A1** high-stigma clinical fields, **A2** the complete clinical record, **A3** the audit ledger's integrity, **A4** availability of the chart at the bedside, **A5** staff credentials.

| ID  | Adversary                    | Capability                                | Attack                                             | Control                                                                                                            | Residual risk                                                                 | Test           |
| :-- | :--------------------------- | :---------------------------------------- | :------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------- | :------------- |
| T1  | Curious clerk                | Valid low-privilege login                 | Open clinical file of a patient they never treated | Deny-by-default policy + field redaction at serialization + `RULE-ABUSE-01` blocks and alerts                      | Clerk can still see demographics of their own intake queue — by design        | AT-401         |
| T2  | Off-ward staff               | Valid login, wrong ward                   | Browse another ward's charts                       | Ward predicate denies; 403 with break-glass affordance; `RULE-ABUSE-02`                                            | Break-glass is available to them — deliberately, and it is loud               | AT-105         |
| T3  | Departed intern              | Credentials not yet revoked               | Log in after transfer                              | Shift + duty predicate; `RULE-ABUSE-03`; account expiry date on every user                                         | Window between departure and expiry                                           | AT-108         |
| T4  | Snoop with DB write access   | Can `sqlite3` the file                    | Edit or delete the row recording their access      | Append-only triggers; hash chain breaks on edit; `broken_at_index` localises it                                    | They can still destroy the file (availability, not confidentiality)           | AT-305         |
| T5  | Attacker with host root      | Owns file **and** application             | Rewrite history and recompute the whole chain      | External witness anchors: local head diverges from the last signed receipt → `WITNESS_DIVERGED` alarm              | Anchoring interval (≤ 60 min) is the blind window; shortened to 5 min in demo | AT-313         |
| T6  | Ransomware operator          | Encrypts the edge node                    | Deny care to force payment                         | 4-hourly `VACUUM INTO` backups + offline device cache + paper SOP; restore drill is a tested procedure             | Data since last backup; bounded by backup interval                            | AT-514, AT-905 |
| T7  | Shoulder-surfer / next shift | Physical access to an unattended terminal | Read the chart left on screen                      | 3-minute idle lock with frosted overlay; 15-minute hard purge; PIN re-auth                                         | Sub-3-minute exposure                                                         | AT-115         |
| T8  | Ciphertext-swapping insider  | DB write access                           | Move Patient X's HIV ciphertext onto Patient Y     | AES-256-GCM AAD binds ciphertext to `patient_id`+column+key version; decryption fails closed                       | Row becomes unreadable — a detected integrity failure, not a silent lie       | AT-117         |
| T9  | Break-glass abuser           | Clinician credentials                     | Use emergency access as a routine shortcut         | Scoped 60-min single-patient grant, CMO dispatch, `RULE-ABUSE-04` frequency spike, mandatory post-hoc review queue | Abuse is possible but never invisible — this is the intended trade            | AT-405         |
| T10 | Network attacker             | On the ward LAN                           | Intercept or replay                                | TLS 1.3 only; HSTS; JWT `jti` replay cache; refresh rotation with reuse detection                                  | Compromised TLS terminator on the same node                                   | AT-907         |

**The design position.** GridVault does not claim to stop an attacker with root. It claims that such an attacker cannot _quietly_ rewrite the record of what they read — the witness diverges, and the divergence is visible to someone who does not work in the hospital's IT department. That, and not encryption, is the property the brief is asking for.

---

## 6. Access control model

### 6.1 The decision function

Every read and write of patient data passes through exactly one function. There is no second path, no `if (user.role === 'admin') return true` shortcut anywhere else in the codebase, and a lint rule forbids importing the repositories from route handlers directly.

```
decide(subject, action, resource, context) -> Decision

Decision = {
  effect:        'ALLOW' | 'DENY',
  visible_fields: FieldGroup[],          // ⊆ requested
  redacted_fields: FieldGroup[],         // returned as [RESTRICTED]
  reason_code:   PolicyReason,           // stable machine code
  obligations:   Obligation[]            // e.g. AUDIT_WRITE, RAISE_ABUSE(rule), WATERMARK
}
```

Evaluation order (first match wins; the default is DENY):

```
1.  subject.account_status != 'active'                        -> DENY  ACCOUNT_INACTIVE
2.  subject.expires_at < now                                  -> DENY  ACCOUNT_EXPIRED
3.  action requires break-glass && valid grant exists         -> ALLOW EMERGENCY_GRANT
                                                                 (fields = grant.scope, obligations += AUDIT_WRITE)
4.  role == 'clerk'  && field_group ∈ CLINICAL ∪ SENSITIVE    -> DENY  CLERK_NO_CLINICAL
                                                                 (obligations += RAISE_ABUSE(RULE-ABUSE-01) if patient ∉ intake_queue)
5.  role == 'clerk'  && patient ∉ subject.intake_queue        -> DENY  CLERK_OUT_OF_QUEUE
                                                                 (obligations += RAISE_ABUSE(RULE-ABUSE-01))
6.  role ∈ {'admin','cmo'} && field_group ∈ CLINICAL ∪ SENSITIVE -> DENY ADMIN_NO_CLINICAL
                                                                 (obligations += RAISE_ABUSE(RULE-ABUSE-05))
7.  resource.ward != subject.assigned_ward                    -> DENY  WARD_MISMATCH
                                                                 (obligations += RAISE_ABUSE(RULE-ABUSE-02), offer_break_glass = true)
8.  duty_state(subject, now) == 'off_duty'                    -> DENY  OFF_DUTY
                                                                 (obligations += RAISE_ABUSE(RULE-ABUSE-03), offer_break_glass = true)
9.  duty_state(subject, now) == 'handover_grace'              -> ALLOW HANDOVER_GRACE (read-only; writes DENY)
10. field_group ∈ SENSITIVE && role ∉ {'doctor','nurse'}      -> DENY  SENSITIVE_CLINICIAN_ONLY
11. action == 'write' && !WRITE_MATRIX[role][field_group]     -> DENY  ROLE_CANNOT_WRITE
12. otherwise                                                 -> ALLOW ROLE_WARD_DUTY_SATISFIED
```

`reason_code` is returned to the client, written into the audit entry's `details.decision`, and rendered in the UI as the explanation for a lock icon. A user is never told "no" without being told _which_ of the three dimensions said no — silent denial trains staff to share logins.

### 6.2 Field groups

| Group          | Fields                                                                                            |
| :------------- | :------------------------------------------------------------------------------------------------ |
| `DEMOGRAPHICS` | `full_name`, `hospital_number`, `age`, `gender`, `ward`, `bed_number`, `admission_date`, `status` |
| `LOGISTICS`    | `next_of_kin`, `contact_phone`, `address_lga`, `payer`, `admission_source`                        |
| `VITALS`       | `heart_rate`, `blood_pressure`, `spo2`, `temperature`, `respiratory_rate`, `pain_score`           |
| `CLINICAL`     | `primary_diagnosis`, `clinical_notes`, `allergies`, `medications_summary`, `mar_entries`          |
| `SENSITIVE`    | `hiv_status`, `genotype`, `pregnancy_status`, `mental_health_notes`                               |
| `AUDIT`        | ledger rows, verification results, witness status                                                 |
| `ADMIN`        | user accounts, roles, ward assignments, system configuration                                      |

### 6.3 Effective permission matrix

`RW` read+write · `R` read-only · `—` redacted as `[RESTRICTED]` · `✗` 403, resource not enumerated

| Group          | Doctor (own ward)   | Nurse (own ward) | Clerk (own queue) | Admin              | CMO                | Any role, off-ward, no grant   | Any role, off-ward, **with grant** |
| :------------- | :------------------ | :--------------- | :---------------- | :----------------- | :----------------- | :----------------------------- | :--------------------------------- |
| `DEMOGRAPHICS` | RW                  | R                | RW                | R (ID + ward only) | R (ID + ward only) | R (name masked: `A•••• O••••`) | R                                  |
| `LOGISTICS`    | R                   | R                | RW                | —                  | —                  | —                              | R                                  |
| `VITALS`       | RW                  | RW               | —                 | —                  | —                  | —                              | RW                                 |
| `CLINICAL`     | RW                  | R + append note  | —                 | —                  | —                  | —                              | RW                                 |
| `SENSITIVE`    | RW                  | R                | —                 | —                  | —                  | —                              | R                                  |
| `AUDIT`        | R (own ward events) | ✗                | ✗                 | RW (read + verify) | RW                 | —                              | —                                  |
| `ADMIN`        | ✗                   | ✗                | ✗                 | RW                 | R                  | ✗                              | ✗                                  |

### 6.4 Redaction contract

- Redaction happens in the serializer, after policy evaluation, before the response is written. Restricted values are never loaded into a DTO and never leave the process. Test AT-116 asserts the plaintext never appears in the raw HTTP response bytes.
- A redacted scalar serializes as the string `"[RESTRICTED]"`. A redacted object or array serializes as `null`. Every response carries a parallel `_meta.redactions` array:

```json
{
  "data": { "hiv_status": "[RESTRICTED]", "genotype": "[RESTRICTED]" },
  "_meta": {
    "redactions": [
      {
        "field": "hiv_status",
        "group": "SENSITIVE",
        "reason_code": "CLERK_NO_CLINICAL",
        "classification": "NDPA-2023-SENSITIVE",
        "can_break_glass": false
      }
    ],
    "policy_version": "2.0.0",
    "decision_id": "dec_01J8ZQ4F3K"
  }
}
```

- The client renders a lock chip with the human string for `reason_code`. It never infers permission from role in JavaScript; the server's `_meta` is the only source of truth for what is hidden and why. (A hostile client gets exactly the same bytes.)

### 6.5 Duty-state function

```
SHIFTS = { morning: [06:00, 14:00), afternoon: [14:00, 22:00), night: [22:00, 06:00) }   // Africa/Lagos
GRACE  = 30 minutes after a shift's end

duty_state(user, t):
  if t ∈ SHIFTS[user.assigned_shift]                     -> 'on_duty'
  if t ∈ [end(SHIFTS[user.assigned_shift]), +GRACE)      -> 'handover_grace'
  if exists active scheduled_extension(user, t)          -> 'on_duty'
  otherwise                                              -> 'off_duty'
```

The night shift wraps midnight and is evaluated as `t >= 22:00 || t < 06:00`. All times are computed in `Africa/Lagos` (UTC+01:00, no DST) regardless of the server's locale; the timezone is a config value, not a hard-coded offset. `handover_grace` allows reads and denies writes, so a nurse finishing notes at 14:20 can still see her patient but cannot chart new observations under an expiring duty.

### 6.6 Authentication

- Passwords: Argon2id, memory 64 MiB, time cost 3, parallelism 4, 32-byte salt. Quick-PINs (4–6 digits, used for unlock and break-glass confirmation) are hashed with the same parameters and are _never_ accepted as a primary login factor.
- Access token: JWT HS256, 15 min, claims `sub`, `staff_id`, `role`, `ward`, `shift`, `session_id`, `jti`, `iat`, `exp`, `policy_version`. Grants are **not** carried in the token — they are looked up server-side per request so revocation is immediate.
- Refresh: opaque 256-bit token in an `HttpOnly; Secure; SameSite=Strict; Path=/api/auth` cookie, 8-hour absolute lifetime, rotated on every use, with reuse detection (a replayed refresh token invalidates the whole session family and raises a `CRITICAL` alert).
- Rate limiting: 5 failed logins per `staff_id` and per source IP per 10 minutes → 15-minute lockout + audit event + abuse alert. Successful login resets the counter. Break-glass is exempt from IP lockout (a ward terminal must not be bricked by another user's typos) but not from per-staff PIN throttling.
- Login is audited whether it succeeds or fails. `LOGIN_FAILED` entries never record the attempted password, and record the staff ID only if it exists.

---

## 7. Emergency clinical override ("break-glass")

### 7.1 Requirements

- **Immediate.** From a locked chart: click **Emergency Clinical Override** → choose a reason → confirm with PIN. Two interactions, ≤ 1 s to a readable chart. No approval step, no second person, no network round-trip to any authority outside the ward node.
- **Never coverable.** Four independent traces, each on a different failure path: (1) the scoped grant row, (2) the hash-chained audit entry, (3) the notifier outbox dispatch to CMO + charge nurse, (4) the persistent red session banner visible to anyone standing at the terminal.
- **Scoped.** One staff member, one patient, one justification, 60 minutes, revocable at any moment by CMO or admin. A grant on the trauma patient in ICU does not open the rest of ICU and does not survive the clinician's logout.
- **Honest.** The modal states the consequence in plain language before the click, not after.

### 7.2 Grant lifecycle

```
                 ┌──────────┐  execute (PIN ok)   ┌─────────┐
 locked chart ──►│ REQUESTED │────────────────────►│ ACTIVE  │
                 └──────────┘                      └────┬────┘
                       │ PIN fail ×3                    │
                       ▼                                ├── 60 min elapse ──► EXPIRED
                 ┌──────────┐                           ├── clinician "End emergency access" ──► CLOSED
                 │ REJECTED │                           ├── CMO/admin revoke ──► REVOKED
                 └──────────┘                           └── clinician logout ──► CLOSED
```

Every transition writes a ledger entry. `ACTIVE` is the only state that grants anything; the policy engine re-reads it per request, so `REVOKED` takes effect on the clinician's very next click.

### 7.3 Justification codes

`ACUTE_TRAUMA_UNCONSCIOUS` · `CARDIAC_ARREST_CODE_BLUE` · `SEVERE_SEPSIS_DECOMPENSATION` · `OBSTETRIC_EMERGENCY` · `PAEDIATRIC_EMERGENCY` · `URGENT_SURGICAL_CONSULT` · `MASS_CASUALTY_TRIAGE` · `OTHER` (free text ≥ 20 characters, mandatory).

A code is required; free text is optional except for `OTHER`. The list is configuration, not code, so a facility can align it with its own clinical governance policy.

### 7.4 Grant scope

`SENSITIVE` fields are **read-only** under a grant, for every role. A clinician resuscitating a patient needs to _know_ the genotype and HIV status; nobody needs to _edit_ them under emergency conditions, and making them read-only removes an entire class of destructive accident. `VITALS` and `CLINICAL` are read-write so that the emergency can actually be documented.

### 7.5 Notification

`Notifier` interface with pluggable drivers. Default driver: `OutboxNotifier` — writes to a durable `notification_outbox` table, delivered by a worker with exponential backoff, surviving restarts and power cuts. Additional drivers (`WebhookNotifier`, `SmtpNotifier`, `SmsNotifier`) are configuration-selected and out of scope for v2 delivery guarantees. **The grant is never blocked on delivery**: the outbox row is written in the same transaction as the grant, so a failure to reach the CMO's phone can never delay care, and can never silently vanish either. Undelivered dispatches older than 15 minutes surface in the security console as `DISPATCH_DEGRADED`.

### 7.6 Post-hoc review

Every grant lands in a CMO review queue with states `PENDING_REVIEW → ACKNOWLEDGED | ESCALATED`. Reviews are themselves ledger entries. The security console shows break-glass rate per clinician per 30 days, so the fourth override in a week by the same doctor is visible as a pattern rather than as four isolated events.

---

## 8. Tamper-evident audit ledger

### 8.1 What is logged

Every one of: `LOGIN`, `LOGIN_FAILED`, `LOGOUT`, `SESSION_LOCK`, `SESSION_UNLOCK`, `VIEW_ROSTER`, `VIEW_RECORD`, `VIEW_SENSITIVE`, `ACCESS_DENIED`, `RECORD_VITALS`, `UPDATE_CLINICAL`, `SIGN_MAR`, `APPEND_NOTE`, `EXPORT_HANDOVER`, `PRINT_RECORD`, `EMERGENCY_OVERRIDE_REQUESTED`, `EMERGENCY_OVERRIDE_GRANTED`, `EMERGENCY_OVERRIDE_CLOSED`, `EMERGENCY_OVERRIDE_REVOKED`, `OVERRIDE_REVIEWED`, `ABUSE_ALERT_RAISED`, `ABUSE_ALERT_RESOLVED`, `SYNC_REPLAY`, `BACKFILL_PAPER_SLIP`, `USER_CREATED`, `USER_MODIFIED`, `USER_DEACTIVATED`, `CHAIN_ANCHORED`, `CHAIN_VERIFIED`, `BACKUP_CREATED`, `RESTORE_PERFORMED`.

**Denials are logged as loudly as grants.** A log that only records success cannot show you a reconnaissance sweep.

### 8.2 Entry structure

| Column         | Type                     | Notes                                                          |
| :------------- | :----------------------- | :------------------------------------------------------------- |
| `log_index`    | INTEGER PK AUTOINCREMENT | dense, starts at 1                                             |
| `timestamp`    | TEXT                     | ISO-8601 with explicit offset, `2026-09-13T14:22:07.318+01:00` |
| `staff_id`     | TEXT                     | or `SYSTEM`                                                    |
| `staff_role`   | TEXT                     | role at time of action, not current role                       |
| `ward`         | TEXT                     | ward of the terminal                                           |
| `patient_id`   | TEXT                     | or `SYSTEM`                                                    |
| `action`       | TEXT                     | from §8.1                                                      |
| `details`      | TEXT                     | canonical JSON (§8.3)                                          |
| `session_id`   | TEXT                     | correlates a burst of activity to one login                    |
| `terminal_id`  | TEXT                     | device fingerprint / configured terminal name                  |
| `source_ip`    | TEXT                     |                                                                |
| `prev_hash`    | TEXT                     | 64 hex chars                                                   |
| `current_hash` | TEXT                     | 64 hex chars                                                   |

`details` **never** contains PHI values. It contains field _names_, decision codes, counts and identifiers. `VIEW_SENSITIVE` records that `hiv_status` was read — never that it was reactive. Otherwise the audit log becomes the largest unprotected copy of the data it exists to protect. AT-315 greps the whole ledger for known seed PHI values and fails if any appear.

### 8.3 Canonical serialization and hash

```
canonical(entry) = JSON of an ordered array, UTF-8, no insignificant whitespace:
  [ "gridvault.audit.v2",        // domain separator — prevents cross-context hash reuse
    log_index, timestamp, staff_id, staff_role, ward, patient_id,
    action, canonical_json(details), session_id, terminal_id, source_ip, prev_hash ]

current_hash = SHA256( canonical(entry) )   // lowercase hex
```

`canonical_json` sorts object keys lexicographically, rejects `NaN`/`Infinity`, escapes to pure ASCII, and serializes numbers per ECMA-262 `Number::toString`. Genesis (`log_index = 1`) uses `prev_hash = "0".repeat(64)`.

This replaces v1's pipe-delimited concatenation, under which `details = "a|b"` and the adjacent fields could be rearranged to produce an identical payload — a forgery that verification would have accepted.

### 8.4 Append-only enforcement

Defence in depth, three layers:

1. **Database triggers.**

```sql
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;

CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
```

2. **Application layer.** The ledger repository exposes `append()` and `read()`. There is no `update()` or `delete()` to call. The append path holds an `IMMEDIATE` transaction so concurrent writers cannot interleave and fork the chain.
3. **Verification.** Anything that defeats layers 1 and 2 — `sqlite3` on the file, a dropped trigger — breaks the chain at the edited index, and breaks the witness comparison even if the whole chain is recomputed.

### 8.5 Verification engine

`GET /api/audit/verify` streams the ledger in `log_index` order and checks, per row: index density (no gaps, no duplicates), `prev_hash == previous.current_hash`, `current_hash == SHA256(canonical(row))`, monotonic non-decreasing timestamps, and head hash equal to the latest witness receipt.

```json
{
  "status": "HEALTHY",
  "total_records": 1284,
  "broken_at_index": null,
  "failure_kind": null,
  "head_hash": "9f2c…",
  "witness": {
    "status": "ANCHORED",
    "last_anchor_index": 1250,
    "last_anchor_at": "2026-09-13T14:00:00+01:00",
    "divergence": null
  },
  "verified_at": "2026-09-13T14:22:09+01:00",
  "duration_ms": 41
}
```

`status` ∈ `HEALTHY` | `TAMPERED` | `TRUNCATED` | `WITNESS_DIVERGED`. `failure_kind` ∈ `HASH_MISMATCH` | `CHAIN_BREAK` | `INDEX_GAP` | `INDEX_DUPLICATE` | `TIMESTAMP_REGRESSION` | `WITNESS_MISMATCH`. Distinguishing these matters: a deleted row and an edited row are different attacks and lead to different incident responses.

### 8.6 External witness anchoring

Every `ANCHOR_INTERVAL_MINUTES` (default 60; 5 in demo) and on every `EMERGENCY_OVERRIDE_GRANTED`, the node signs and submits an anchor receipt:

```json
{
  "facility_id": "lasuth-ikeja",
  "chain_head_index": 1250,
  "chain_head_hash": "9f2c…",
  "entry_count": 1250,
  "anchored_at": "2026-09-13T14:00:00+01:00",
  "node_signature": "ed25519:…",
  "receipt_id": "anc_01J8…"
}
```

The witness stores receipts append-only under separate credentials and separate custody (in the reference deployment, a second container with its own volume; in a real deployment, the state ministry or a regional node). Verification compares the local chain against the newest receipt. Divergence sets `WITNESS_DIVERGED` and raises a `CRITICAL` alert that cannot be cleared from within the node.

If the witness is unreachable, receipts queue in the outbox and the console shows `ANCHOR_PENDING` with the age of the oldest unsent receipt. **Anchoring never blocks clinical work.**

### 8.7 Independent offline verification

`npm run gv -- export-ledger --out ledger.jsonl` writes the ledger as newline-delimited canonical JSON with the anchor receipts appended. `npm run gv -- verify-ledger --file ledger.jsonl` recomputes every hash in a standalone process with no database access and no network. A judge, an auditor or a court can therefore check the chain without trusting the running system — which is the entire point of the control. AT-314 runs the verifier against an exported, then hand-edited, file.

---

## 9. Abuse detection

### 9.1 Pipeline

Rules evaluate synchronously, inside the request, before the response is serialized, and can block. A rule that only annotates a log after the fact does not stop the clerk from reading the HIV status.

```
request → authn → policy.decide() → obligations → rule engine → [block?] → serializer → response
                                                        │
                                                        └─► abuse_alerts + audit entry + console push (SSE)
```

### 9.2 Rules

| ID              | Name                         | Predicate                                                                                       | Severity                            | Action                                                                                                                      |
| :-------------- | :--------------------------- | :---------------------------------------------------------------------------------------------- | :---------------------------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| `RULE-ABUSE-01` | Clerk clinical probe         | `role=='clerk'` AND (`field_group ∈ CLINICAL ∪ SENSITIVE` OR `patient ∉ intake_queue(clerk)`)   | CRITICAL                            | Block (403 for out-of-queue, redact + alert for clinical fields), alert, ledger entry                                       |
| `RULE-ABUSE-02` | Off-ward snooping            | `resource.ward != subject.assigned_ward` AND no active grant                                    | WARNING → CRITICAL on 3rd in 15 min | 403 with break-glass affordance; alert                                                                                      |
| `RULE-ABUSE-03` | Off-shift credential use     | `duty_state == 'off_duty'` AND no scheduled extension                                           | WARNING                             | Deny with break-glass affordance; alert to charge nurse                                                                     |
| `RULE-ABUSE-04` | Break-glass frequency spike  | ≥ 2 grants by one staff member within 60 min, or ≥ 2 distinct wards                             | CRITICAL                            | Grant still succeeds (care first); escalated CMO dispatch, urgent review tag                                                |
| `RULE-ABUSE-05` | Administrator clinical reach | `role ∈ {'admin','cmo'}` requests `CLINICAL ∪ SENSITIVE`                                        | CRITICAL                            | Block; alert routed to CMO **and** the facility's data protection officer — an admin alert must not be triaged by the admin |
| `RULE-ABUSE-06` | Bulk enumeration             | > 20 distinct `patient_id` reads by one subject in 5 min, or > 60 in 60 min                     | WARNING → CRITICAL at 2×            | Throttle to 1 rps, alert                                                                                                    |
| `RULE-ABUSE-07` | Sensitive-field sweep        | ≥ 5 distinct patients' `SENSITIVE` group read in 10 min without a corresponding care assignment | CRITICAL                            | Block further sensitive reads for 15 min; alert                                                                             |
| `RULE-ABUSE-08` | Credential stuffing          | ≥ 5 failed logins for one `staff_id` or IP in 10 min                                            | WARNING                             | 15-min lockout; alert                                                                                                       |
| `RULE-ABUSE-09` | Refresh token reuse          | A rotated refresh token is presented twice                                                      | CRITICAL                            | Kill the session family; force re-login; alert                                                                              |

Thresholds live in `config/abuse-rules.json` so a facility can tune them without a redeploy; the file is validated by Zod at boot and a bad value fails startup loudly rather than silently disabling a rule.

### 9.3 Alert lifecycle

`FLAGGED → INVESTIGATING → RESOLVED(justified | confirmed_abuse | false_positive)`. Resolution requires a note and is a ledger entry. A staff member can never resolve an alert raised against themselves — enforced server-side, tested by AT-408.

### 9.4 The mandatory demonstration

Clerk Ibrahim Danjuma (`RC-1029`, Admissions, afternoon) opens the clinical file of Amara Okafor (`HOSP-LOS-2025-082`, Ward A) — a patient he never admitted and does not treat, with a sensitive obstetric history and Hb AS genotype.

Observable, in this order, within one second:

1. HTTP **403** with `reason_code: "CLERK_OUT_OF_QUEUE"`; no clinical bytes in the response.
2. `abuse_alerts` row: `RULE-ABUSE-01`, CRITICAL, FLAGGED, with staff, target, terminal and IP.
3. Two ledger entries (`ACCESS_DENIED`, `ABUSE_ALERT_RAISED`) chained onto the head.
4. A live card in the security console, pushed over SSE without a refresh.
5. `GET /api/audit/verify` still returns `HEALTHY` — the record of the attempt is itself protected.

The console's **Run abuse demonstration** button performs this as a genuine authenticated request as Ibrahim. It does not fabricate an alert row; it triggers the real control. AT-401 asserts the request path was real by checking that the alert's `decision_id` matches a decision produced by the policy engine in that request.

---

## 10. Offline resilience and the downtime protocol

### 10.1 The answer, in one paragraph

_(This is the deliverable the brief asks for. It is reproduced verbatim in `docs/DOWNTIME-SOP.md` and on the login screen's help panel.)_

> **When GridVault is unreachable, care does not stop and the record does not break.** The ward terminal keeps working from its encrypted local cache: staff can open any patient on their own ward, read the last known chart, and record vitals, medications and notes. A persistent amber bar shows the terminal is offline and counts the items waiting to sync. When the network returns, everything queued is replayed in order, de-duplicated, signed into the audit ledger, and marked as offline-captured with the time it was actually taken. **If the terminal itself is down** — no power, no device, hardware failure — staff use the pre-printed three-part Emergency Triage Slips kept in the ward lockbox: patient hospital number, time, vitals, medication given, staff signature. One copy stays in the patient's folder, one goes to the ward file, one goes to the charge nurse. When the system returns, the charge nurse enters the slips through **Batch Backfill**, which records the original bedside time _and_ the entry time, marks each entry `PAPER_BACKFILL`, names the person who transcribed it, and signs it into the chain. Nothing is back-dated silently, and every offline entry is distinguishable from a live one forever.

### 10.2 Three tiers

| Tier                        | When                          | Capability                                                                                                                              | Limits                                                                                                                                                |
| :-------------------------- | :---------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T1 — Browser edge cache** | API unreachable, device alive | Read own-ward roster + last dossier snapshot; capture vitals, MAR sign-offs, notes; break-glass is **queued as requested, not granted** | No cross-ward reads; no new patient registration; `SENSITIVE` fields cached only for patients the user already legitimately opened, and only for 24 h |
| **T2 — Ward edge node**     | Internet down, LAN alive      | Full system. This is the normal state in most facilities                                                                                | Upstream sync and anchoring queue                                                                                                                     |
| **T3 — Paper SOP**          | Node or power down            | Triage slips → Batch Backfill                                                                                                           | Manual transcription; rate-limited and reviewed                                                                                                       |

**Break-glass while offline** is the hard case, and the answer is deliberate: a grant cannot be issued offline because it cannot be dispatched or witnessed. Instead T1 grants _local emergency read_ of the cached snapshot the device already holds, renders the same red banner, writes a locally-chained pending entry, and forces the CMO dispatch and the real grant record the moment connectivity returns. Care is never blocked; the notification is delayed by exactly the outage, and the delay itself is recorded.

### 10.3 Cache policy

- Store: IndexedDB, one object store per entity, encrypted with AES-GCM via Web Crypto under a key derived from the session (PBKDF2-SHA256, 210,000 iterations) and held only in memory.
- Contents: own-ward roster (≤ 60 patients), the last 20 dossiers the user opened, last 24 h of vitals, the mutation queue.
- Purge: on logout, on hard-lock expiry (15 min), on session-family invalidation, on role/ward change, and automatically 24 h after write. A background sweep runs on every app boot.
- Never cached: other wards' patients, audit ledger rows, admin data, any `SENSITIVE` field the user was not authorized to see at cache time.

### 10.4 Mutation queue

```json
{ "client_mutation_id": "cm_01J8ZQ…",   // UUIDv7, idempotency key
  "device_id": "term-warda-02",
  "device_seq": 41,                       // monotonic per device, gap = lost mutation
  "type": "VITALS" | "MAR_SIGN" | "NOTE_APPEND" | "PAPER_BACKFILL",
  "patient_id": "HOSP-LOS-2025-082",
  "base_version": 17,                     // patient row version the client last saw
  "payload": { … },
  "captured_at": "2026-09-13T13:58:02+01:00",
  "captured_at_source": "device_clock" | "user_entered",
  "attempts": 0 }
```

### 10.5 Reconciliation

1. `POST /api/sync/batch` accepts ≤ 100 mutations, ordered by `(device_id, device_seq)`.
2. **Idempotency:** a `client_mutation_id` already present returns the original result. Replaying the whole batch after a dropped response is safe — AT-508 replays every batch twice and asserts identical state.
3. **Additive types** (`VITALS`, `NOTE_APPEND`, `MAR_SIGN`) never conflict. They are appended to a time series keyed by `(patient_id, device_id, device_seq)` and tagged `is_offline_sync = 1`.
4. **Mutating types** (patient status, bed transfer) use optimistic concurrency on `patients.version`. A `base_version` mismatch returns `409` with both values and queues a charge-nurse reconciliation task. GridVault never silently picks a winner for demographics.
5. **Clock skew:** if `|captured_at − server_now|` > 10 min, the entry is stored with both timestamps and flagged `CLOCK_SKEW_SUSPECT`. Ordering within a device always uses `device_seq`, never the clock.
6. **Sequence gaps** raise `SYNC_GAP_DETECTED` naming the device and the missing range, so a lost mutation is visible rather than invisible.
7. Each applied mutation writes a `SYNC_REPLAY` ledger entry carrying `client_mutation_id`, `device_id`, `device_seq` and both timestamps.
8. Response: `{ processed, duplicates_ignored, conflicts, audit_entries_created, results[] }`.

### 10.6 Detection and UX

Offline is detected by `navigator.onLine` **plus** a 10-second heartbeat against `GET /api/health/ping` (a browser reports "online" when attached to a Wi-Fi router whose uplink is dead — the common Nigerian failure mode). Three consecutive heartbeat failures flip to offline; one success flips back and starts sync. The header shows `Online · Ward Edge Node` (green), `Offline · Local cache active · N queued` (amber), or `Syncing · N of M` (blue). A manual **Simulate grid outage** toggle exercises the same code path for demonstration and is available in all environments, clearly labelled as a simulation.

---

## 11. Data model

SQLite, WAL, `foreign_keys = ON`. Migrations are numbered, forward-only, and applied at boot inside a transaction with a recorded `schema_migrations` row. No `IF NOT EXISTS` improvisation at runtime.

```sql
-- ─── Identity ────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id              TEXT PRIMARY KEY,
  staff_id        TEXT UNIQUE NOT NULL,
  full_name       TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('doctor','nurse','clerk','admin','cmo')),
  assigned_ward   TEXT NOT NULL,
  assigned_shift  TEXT NOT NULL CHECK (assigned_shift IN ('morning','afternoon','night')),
  password_hash   TEXT NOT NULL,          -- argon2id
  pin_hash        TEXT NOT NULL,          -- argon2id, break-glass + unlock only
  account_status  TEXT NOT NULL DEFAULT 'active'
                  CHECK (account_status IN ('active','suspended','expired')),
  expires_at      TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  family_id       TEXT NOT NULL,          -- refresh rotation family
  refresh_hash    TEXT NOT NULL,
  terminal_id     TEXT,
  source_ip       TEXT,
  issued_at       TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  revoked_at      TEXT,
  revoked_reason  TEXT
);
CREATE INDEX idx_sessions_family ON sessions(family_id);

CREATE TABLE scheduled_extensions (   -- sanctioned overtime / handover cover
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
  approved_by TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL
);

-- ─── Patients ────────────────────────────────────────────────────────────────
CREATE TABLE patients (
  id              TEXT PRIMARY KEY,
  hospital_number TEXT UNIQUE NOT NULL,
  full_name       TEXT NOT NULL,
  age             INTEGER NOT NULL CHECK (age BETWEEN 0 AND 130),
  gender          TEXT NOT NULL CHECK (gender IN ('male','female')),
  ward            TEXT NOT NULL,
  bed_number      TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('stable','observation','critical','discharged')),
  admission_date  TEXT NOT NULL,
  admitted_by     TEXT REFERENCES users(id),      -- the clerk who did intake
  version         INTEGER NOT NULL DEFAULT 1,     -- optimistic concurrency
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_patients_ward_status ON patients(ward, status);
CREATE UNIQUE INDEX idx_patients_bed ON patients(ward, bed_number)
  WHERE status != 'discharged';

CREATE TABLE patient_logistics (
  patient_id TEXT PRIMARY KEY REFERENCES patients(id),
  next_of_kin TEXT, contact_phone TEXT, address_lga TEXT,
  payer TEXT, admission_source TEXT, updated_at TEXT NOT NULL
);

-- Who is legitimately caring for whom. Without this, "abuse" is unprovable.
CREATE TABLE care_assignments (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  user_id    TEXT NOT NULL REFERENCES users(id),
  relationship TEXT NOT NULL CHECK (relationship IN
      ('attending','nurse_of_record','consulting','intake_clerk')),
  active_from TEXT NOT NULL, active_to TEXT,
  assigned_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE INDEX idx_care_user_active ON care_assignments(user_id, active_to);

CREATE TABLE admissions_queue (        -- the clerk's legitimate working set
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  clerk_id   TEXT NOT NULL REFERENCES users(id),
  opened_at  TEXT NOT NULL, closed_at TEXT,
  UNIQUE (patient_id, clerk_id, opened_at)
);

-- ─── Clinical ────────────────────────────────────────────────────────────────
CREATE TABLE clinical_data (
  patient_id          TEXT PRIMARY KEY REFERENCES patients(id),
  primary_diagnosis   TEXT NOT NULL,
  allergies           TEXT,
  medications_summary TEXT,
  -- AES-256-GCM, format  v<keyver>:<iv_b64>:<ct_b64>:<tag_b64>
  -- AAD = patient_id || ':' || column_name || ':' || key_version
  hiv_status_enc      TEXT NOT NULL,
  genotype_enc        TEXT NOT NULL,
  pregnancy_status_enc TEXT,
  mental_health_notes_enc TEXT,
  key_version         INTEGER NOT NULL DEFAULT 1,
  version             INTEGER NOT NULL DEFAULT 1,
  updated_at          TEXT NOT NULL
);

CREATE TABLE vitals (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  heart_rate INTEGER NOT NULL CHECK (heart_rate BETWEEN 20 AND 250),
  blood_pressure TEXT NOT NULL,           -- 'systolic/diastolic'
  spo2 INTEGER NOT NULL CHECK (spo2 BETWEEN 50 AND 100),
  temperature REAL NOT NULL CHECK (temperature BETWEEN 30.0 AND 45.0),
  respiratory_rate INTEGER, pain_score INTEGER CHECK (pain_score BETWEEN 0 AND 10),
  recorded_by TEXT NOT NULL REFERENCES users(staff_id),
  recorded_at TEXT NOT NULL,              -- bedside time
  ingested_at TEXT NOT NULL,              -- server time
  is_offline_sync INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'live' CHECK (source IN ('live','offline_sync','paper_backfill')),
  device_id TEXT, device_seq INTEGER,
  client_mutation_id TEXT UNIQUE,         -- idempotency
  clock_skew_flag INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_vitals_patient_time ON vitals(patient_id, recorded_at DESC);

CREATE TABLE clinical_notes (
  id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id),
  author_staff_id TEXT NOT NULL, note_type TEXT NOT NULL
    CHECK (note_type IN ('nursing','medical','handover','psychiatric')),
  body TEXT NOT NULL, written_at TEXT NOT NULL, ingested_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'live', client_mutation_id TEXT UNIQUE
);  -- append-only by convention; amendments are new rows referencing the original

CREATE TABLE mar_entries (
  id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id),
  medication TEXT NOT NULL, dose TEXT NOT NULL, route TEXT NOT NULL,
  scheduled_at TEXT NOT NULL, administered_at TEXT, administered_by TEXT,
  witnessed_by TEXT, status TEXT NOT NULL
    CHECK (status IN ('scheduled','given','held','refused','missed')),
  source TEXT NOT NULL DEFAULT 'live', client_mutation_id TEXT UNIQUE
);

-- ─── Ledger ──────────────────────────────────────────────────────────────────
CREATE TABLE audit_logs (
  log_index INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL, staff_id TEXT NOT NULL, staff_role TEXT NOT NULL,
  ward TEXT NOT NULL, patient_id TEXT NOT NULL, action TEXT NOT NULL,
  details TEXT NOT NULL, session_id TEXT, terminal_id TEXT, source_ip TEXT,
  prev_hash TEXT NOT NULL CHECK (length(prev_hash) = 64),
  current_hash TEXT NOT NULL CHECK (length(current_hash) = 64)
);
CREATE INDEX idx_audit_staff_time ON audit_logs(staff_id, timestamp DESC);
CREATE INDEX idx_audit_patient_time ON audit_logs(patient_id, timestamp DESC);
CREATE INDEX idx_audit_action ON audit_logs(action);
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs
  BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs
  BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;

CREATE TABLE chain_anchors (
  receipt_id TEXT PRIMARY KEY, chain_head_index INTEGER NOT NULL,
  chain_head_hash TEXT NOT NULL, entry_count INTEGER NOT NULL,
  anchored_at TEXT NOT NULL, node_signature TEXT NOT NULL,
  witness_ack TEXT, witness_acked_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING','ACKNOWLEDGED','FAILED'))
);

-- ─── Break-glass ─────────────────────────────────────────────────────────────
CREATE TABLE emergency_overrides (
  id TEXT PRIMARY KEY,
  audit_log_index INTEGER NOT NULL REFERENCES audit_logs(log_index),
  staff_id TEXT NOT NULL, patient_id TEXT NOT NULL REFERENCES patients(id),
  ward TEXT NOT NULL, justification_code TEXT NOT NULL, justification_notes TEXT,
  state TEXT NOT NULL CHECK (state IN ('ACTIVE','EXPIRED','CLOSED','REVOKED')),
  granted_at TEXT NOT NULL, expires_at TEXT NOT NULL, closed_at TEXT,
  revoked_by TEXT, revoked_reason TEXT,
  review_state TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
    CHECK (review_state IN ('PENDING_REVIEW','ACKNOWLEDGED','ESCALATED')),
  reviewed_by TEXT, reviewed_at TEXT, review_notes TEXT,
  created_offline INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX idx_override_active ON emergency_overrides(staff_id, patient_id, state, expires_at);

-- ─── Security ────────────────────────────────────────────────────────────────
CREATE TABLE abuse_alerts (
  id TEXT PRIMARY KEY, timestamp TEXT NOT NULL,
  staff_id TEXT NOT NULL, patient_id TEXT NOT NULL,
  rule_triggered TEXT NOT NULL, severity TEXT NOT NULL CHECK (severity IN ('CRITICAL','WARNING','INFO')),
  details TEXT NOT NULL, decision_id TEXT, audit_log_index INTEGER,
  terminal_id TEXT, source_ip TEXT,
  status TEXT NOT NULL DEFAULT 'FLAGGED'
    CHECK (status IN ('FLAGGED','INVESTIGATING','RESOLVED')),
  resolution TEXT CHECK (resolution IN ('justified','confirmed_abuse','false_positive')),
  resolved_by TEXT, resolved_at TEXT, resolution_notes TEXT
);
CREATE INDEX idx_abuse_status_time ON abuse_alerts(status, timestamp DESC);

CREATE TABLE notification_outbox (
  id TEXT PRIMARY KEY, channel TEXT NOT NULL, recipient TEXT NOT NULL,
  subject TEXT NOT NULL, body TEXT NOT NULL, priority TEXT NOT NULL,
  related_type TEXT, related_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING','DISPATCHED','DELIVERED','FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  created_at TEXT NOT NULL, dispatched_at TEXT, delivered_at TEXT
);

CREATE TABLE sync_mutations (        -- idempotency ledger for offline replay
  client_mutation_id TEXT PRIMARY KEY, device_id TEXT NOT NULL,
  device_seq INTEGER NOT NULL, type TEXT NOT NULL, patient_id TEXT NOT NULL,
  applied_at TEXT NOT NULL, result_json TEXT NOT NULL,
  audit_log_index INTEGER, UNIQUE (device_id, device_seq)
);

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL, checksum TEXT NOT NULL
);
```

### 11.1 Column encryption

- Algorithm AES-256-GCM, 96-bit random IV per write, 128-bit tag.
- Format `v<key_version>:<iv_b64>:<ciphertext_b64>:<tag_b64>`.
- **AAD** = `patient_id || ':' || column_name || ':' || key_version`. Ciphertext moved to another row, another column, or replayed under another key version fails authentication and raises `ENCRYPTION_INTEGRITY_FAILURE` (a CRITICAL alert), rather than decrypting into the wrong patient's chart.
- Key hierarchy: `GRIDVAULT_MASTER_KEY` (32 bytes, base64, from env/HSM/file with mode 0400) → HKDF-SHA256 → per-facility DEK, versioned. `npm run gv -- rotate-key` re-encrypts under `key_version + 1` in batches inside a transaction, retaining the ability to read the previous version until rotation completes.
- Decryption happens only inside the record service, only after `decide()` returns ALLOW for `SENSITIVE`, and the plaintext never enters a log, an error message, a cache or a stack trace. Startup fails hard if the master key is missing, shorter than 32 bytes, or equal to the known development key while `NODE_ENV=production`.

---

## 12. API specification

### 12.1 Conventions

- Base path `/api`. JSON only. UTC+01:00 ISO-8601 timestamps with explicit offsets.
- Success: `{ "data": …, "_meta": { … } }`. Error: `{ "error": { "code", "message", "reason_code", "details", "request_id", "can_break_glass" } }`.
- Status codes: `200` ok · `201` created · `204` no content · `400` schema violation · `401` unauthenticated · `403` policy denial · `404` not found _or_ not enumerable to this subject · `409` version conflict · `410` grant expired · `422` clinically invalid · `429` throttled · `500` internal · `503` dependency unavailable.
- `404` is deliberately used where enumeration itself would leak: a clerk querying an ICU patient by ID gets `404`, not `403`, because `403` confirms the patient exists. Where the subject may legitimately know the patient exists (off-ward clinician), `403` with `can_break_glass: true` is correct.
- Every request carries a `request_id` (echoed in `X-Request-Id`) linking response, log line and ledger entry.
- Every mutating endpoint accepts `Idempotency-Key`.
- All list endpoints paginate: `?limit` (default 50, max 200) `&cursor`.

### 12.2 Authentication

| Method | Path                 | Body / query                        | Returns                                             | Audit                            |
| :----- | :------------------- | :---------------------------------- | :-------------------------------------------------- | :------------------------------- |
| POST   | `/api/auth/login`    | `{staff_id, password, terminal_id}` | `{access_token, expires_in, user}` + refresh cookie | `LOGIN` / `LOGIN_FAILED`         |
| POST   | `/api/auth/refresh`  | cookie                              | new access token, rotated cookie                    | — (reuse → `ABUSE_ALERT_RAISED`) |
| POST   | `/api/auth/logout`   | —                                   | `204`                                               | `LOGOUT`                         |
| POST   | `/api/auth/unlock`   | `{pin}`                             | `{access_token}`                                    | `SESSION_UNLOCK`                 |
| GET    | `/api/auth/me`       | —                                   | user + duty state + active grants                   | —                                |
| GET    | `/api/auth/personas` | —                                   | demo personas, **only when `DEMO_MODE=true`**       | —                                |

Ward and shift come from the user record, never from the login request body. v1 accepted `{ward, shift}` from the client, which let any caller choose their own authorization context.

### 12.3 Records

| Method | Path                                                               | Notes                                                                                                                                                                     |
| :----- | :----------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/patients?ward=&status=&search=&cursor=&limit=`               | Roster, scoped by policy. Off-ward patients appear only for `doctor`/`nurse` with names masked and `can_break_glass: true`; never for `clerk`. Audit `VIEW_ROSTER`.       |
| GET    | `/api/patients/:id`                                                | Full dossier, field-redacted per §6. Audit `VIEW_RECORD`, plus `VIEW_SENSITIVE` when sensitive fields are actually released.                                              |
| GET    | `/api/patients/:id/vitals?since=&limit=`                           | Time series.                                                                                                                                                              |
| POST   | `/api/patients/:id/vitals`                                         | `{heart_rate, blood_pressure, spo2, temperature, respiratory_rate?, pain_score?, recorded_at?, client_mutation_id?}`. Recomputes `status` (§12.7). Audit `RECORD_VITALS`. |
| POST   | `/api/patients/:id/notes`                                          | Append-only note. Audit `APPEND_NOTE`.                                                                                                                                    |
| GET    | `/api/patients/:id/mar` · POST `/api/patients/:id/mar/:entry/sign` | MAR view and sign-off. Audit `SIGN_MAR`.                                                                                                                                  |
| PATCH  | `/api/patients/:id`                                                | Demographics/status. Requires `version`; `409` on mismatch. Audit `UPDATE_CLINICAL`.                                                                                      |
| GET    | `/api/handover?ward=`                                              | SBAR handover for the ward, watermarked. Audit `EXPORT_HANDOVER`.                                                                                                         |
| GET    | `/api/admissions/queue`                                            | Clerk's own intake queue.                                                                                                                                                 |

### 12.4 Break-glass

| Method | Path                           | Notes                                                                                                                                                                         |
| :----- | :----------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/override/execute`        | `{patient_id, justification_code, justification_notes?, pin}` → `201 {override_id, audit_index, expires_at, scope, dispatch: {cmo, charge_nurse}}`. p95 ≤ 400 ms server-side. |
| GET    | `/api/override/active`         | Caller's current grants.                                                                                                                                                      |
| POST   | `/api/override/:id/close`      | Clinician ends their own access early.                                                                                                                                        |
| POST   | `/api/override/:id/revoke`     | CMO/admin; takes effect on the next request.                                                                                                                                  |
| GET    | `/api/override?state=&cursor=` | Review queue (CMO/admin).                                                                                                                                                     |
| POST   | `/api/override/:id/review`     | `{decision: acknowledged\|escalated, notes}`.                                                                                                                                 |

### 12.5 Audit and witness

| Method | Path                                                                     | Notes                                                            |
| :----- | :----------------------------------------------------------------------- | :--------------------------------------------------------------- |
| GET    | `/api/audit/logs?limit=&cursor=&staff_id=&patient_id=&action=&from=&to=` | Admin/CMO full; doctor limited to own-ward events.               |
| GET    | `/api/audit/verify`                                                      | §8.5 response. Streams; safe on large ledgers.                   |
| GET    | `/api/audit/export?format=jsonl`                                         | Signed export for offline verification. Audit `EXPORT_HANDOVER`. |
| GET    | `/api/audit/anchors`                                                     | Receipt history and witness status.                              |
| POST   | `/api/audit/anchor`                                                      | Force an anchor now (admin).                                     |
| GET    | `/api/audit/stream`                                                      | SSE of new entries for the live console.                         |

**There is no endpoint that modifies the ledger.** Tamper demonstration is `npm run gv -- demo:tamper --index <n> --field <f>`, which opens the database file directly and disables the trigger exactly as an attacker with host access would — and which refuses to run when `NODE_ENV=production` unless `--i-understand-this-corrupts-the-ledger` is passed.

### 12.6 Abuse, sync, ops

| Method | Path                                          | Notes                                                                                                                                  |
| :----- | :-------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/abuse/alerts?status=&severity=&cursor=` | Alert feed.                                                                                                                            |
| PATCH  | `/api/abuse/alerts/:id`                       | Status/resolution; self-resolution rejected `403`.                                                                                     |
| GET    | `/api/abuse/stream`                           | SSE.                                                                                                                                   |
| POST   | `/api/abuse/demo/clerk-probe`                 | **`DEMO_MODE` only.** Performs a _real_ authenticated request as `RC-1029` and returns the genuine denial + alert. No fabricated rows. |
| POST   | `/api/sync/batch`                             | §10.5.                                                                                                                                 |
| GET    | `/api/sync/status`                            | Server view of a device's last sequence.                                                                                               |
| POST   | `/api/sync/backfill`                          | Paper slip batch entry; charge nurse or admin only.                                                                                    |
| GET    | `/api/health/ping`                            | Unauthenticated liveness, no body.                                                                                                     |
| GET    | `/api/health/ready`                           | DB writable, migrations current, key loaded, chain head readable.                                                                      |
| GET    | `/api/health/metrics`                         | Prometheus text format.                                                                                                                |

### 12.7 Clinical status derivation

Recomputed on every vitals write, and shown in the UI with the triggering value named:

```
critical    if spo2 < 90 || systolic < 90 || systolic >= 180 || diastolic >= 120
            || heart_rate < 40 || heart_rate > 130 || temperature >= 39.5 || temperature < 35.0
observation if spo2 < 95 || systolic >= 140 || diastolic >= 90
            || heart_rate < 50 || heart_rate > 110 || temperature >= 38.0
stable      otherwise
```

This is a triage-support heuristic for prototype demonstration and is labelled as such in the UI (`Auto-triage flag · not a clinical diagnosis`). It never suppresses a manual clinician-set status; a clinician override of the computed status is recorded with its author.

---

## 13. Frontend specification

### 13.1 Routes

| Route                    | Guard         | Contents                                                                     |
| :----------------------- | :------------ | :--------------------------------------------------------------------------- |
| `/`                      | public        | Landing page (existing; claims aligned to §14)                               |
| `/login`                 | public        | Staff ID + password, terminal identity, demo persona bar when `DEMO_MODE`    |
| `/dashboard`             | authenticated | Ward roster, patient cards, filters, offline bar, break-glass                |
| `/dashboard/patient/:id` | authenticated | Dossier: Overview · Vitals · MAR · Notes · **Protected data**                |
| `/dashboard/handover`    | doctor, nurse | SBAR handover, printable, watermarked                                        |
| `/dashboard/admissions`  | clerk         | Intake queue, demographics, bed allocation                                   |
| `/dashboard/security`    | admin, cmo    | Ledger inspector · chain verifier · witness · abuse alerts · override review |
| `/dashboard/admin/users` | admin         | Accounts, roles, wards, extensions, deactivation                             |
| `*`                      | —             | 404                                                                          |

Guards are UX, not security. Every route's data comes from an endpoint that re-evaluates policy server-side.

### 13.2 State

`AuthProvider` (user, duty state, token lifecycle, idle lock), `PolicyProvider` (redaction metadata from `_meta`, never client-side role logic), `OfflineProvider` (heartbeat, cache, queue, sync), `SecurityProvider` (SSE alerts, verification status). Tokens live in memory; the refresh cookie is the only persisted credential. **No PHI in `localStorage` or `sessionStorage`, ever** — only encrypted IndexedDB.

### 13.3 Key components

- **Redaction chip.** Every hidden field renders a lock chip showing the reason (`Restricted to attending clinicians`) and, where applicable, a break-glass affordance. Blur-only masking is forbidden: the value must not be in the DOM.
- **Break-glass modal.** Consequence stated first, justification select, optional notes, PIN, single red confirm. Escape and click-outside cancel. Full keyboard operation and a live region announcing the grant to screen readers.
- **Emergency banner.** Fixed, red, persistent across the whole app while any grant is `ACTIVE`: patient name, audit index, countdown, **End emergency access**.
- **Ledger inspector.** Virtualised table of `index · time · staff · action · patient · prev_hash · current_hash`, with hash truncation and copy-to-clipboard, filters, **Verify chain**, and a verification result banner that names `broken_at_index` and `failure_kind` when a chain is broken.
- **Abuse console.** Live SSE feed, severity colouring, alert detail with the full decision trace, triage controls, and **Run abuse demonstration**.
- **Offline bar.** Status, queued count, last sync time, per-item queue drawer, manual **Sync now**, and the simulation toggle.
- **Lock overlay.** After 3 minutes idle: opaque `backdrop-blur-md` overlay (not transparent — a blur over readable text is not a redaction), all PHI removed from the DOM, PIN to resume; after 15 minutes, memory purge and redirect to `/login`.

### 13.4 Accessibility and UX constraints

WCAG 2.2 AA. Contrast ≥ 4.5:1 (the existing palette is checked in AT-903). Full keyboard reachability with visible focus rings. Modals trap focus and restore it on close. Status changes announced via `aria-live`. Touch targets ≥ 44 px for gloved hands on ward tablets. The critical path — roster → patient → vitals → save — is operable one-handed on a 768 px tablet in portrait. No colour-only signalling: every state carries an icon and a text label.

### 13.5 Performance budgets

Initial JS ≤ 250 KB gzipped; LCP ≤ 2.0 s on a simulated Regular 3G / 4× CPU throttle; roster interaction ≤ 100 ms; dossier open ≤ 300 ms with a warm cache; the app must boot and render a cached roster with the network fully disabled.

---

## 14. Security, privacy and compliance

### 14.1 Regulatory position

The **Nigeria Data Protection Act (NDPA) 2023** is the governing statute; the **NDPR 2019** remains as subsidiary regulation; the **Federal Ministry of Health** National Health ICT standards apply to facility deployment. Health data is sensitive personal data under NDPA §30, requiring a lawful basis, purpose limitation, and demonstrable safeguards.

GridVault's compliance posture is _demonstrable_, not asserted:

- **Purpose limitation** → the policy engine, with the decision recorded per access.
- **Access records** → the hash-chained ledger, externally witnessed.
- **Data minimisation** → field-level redaction at the serialization boundary, and no PHI in logs or audit details.
- **Breach detection** → the abuse engine, with severities and an alert lifecycle.
- **Retention** → §14.6.
- **Data subject rights** → `npm run gv -- subject-access --patient <id>` produces the complete access history for one patient, which is what a patient asking "who looked at my file?" is entitled to.

The product must not claim certification, accreditation or endorsement it does not hold. `docs/COMPLIANCE.md` states precisely which controls are implemented, which are designed but unimplemented, and what a facility must do itself (DPIA, staff training, physical security, appointing a DPO). The landing page is edited in Phase 8 to match that document exactly.

### 14.2 Transport and headers

TLS 1.3 only (1.2 permitted for legacy ward hardware behind a documented config flag). HSTS `max-age=31536000; includeSubDomains`. Helmet with a strict CSP (`default-src 'self'`, no `unsafe-inline` — the Tailwind build emits a static stylesheet, and any inline handler is a build failure), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` denying camera/microphone/geolocation. CORS default-denies; allowed origins are explicit config.

### 14.3 Input handling

Every request body, query and param is parsed by a Zod schema at the route boundary; unparsed input never reaches a service. Rejections return `400` with field paths and never echo the offending value (it might be PHI). All SQL uses bound parameters — string-interpolated SQL is a lint error and a CI failure.

### 14.4 Exfiltration resistance

Copy is disabled on `SENSITIVE` field containers (`user-select: none` plus a `copy` handler), acknowledged as a speed bump, not a control. Printed and exported handover sheets carry a diagonal watermark: `PRINTED BY DR. O. ADEYEMI (GV-9042) · TERM-ICU-01 · 2026-09-13 14:22 WAT · CONFIDENTIAL`, and every print/export is a ledger entry. Bulk export is admin-only, rate-limited, and triggers `RULE-ABUSE-06`.

### 14.5 Secrets and configuration

No secret is ever committed. `.env.example` lists every variable with a description and a safe placeholder. Startup validates configuration with Zod and **refuses to boot** in production when: the master key is missing/short/development-valued, `JWT_SECRET` is under 32 bytes, `DEMO_MODE=true`, TLS is disabled without `ALLOW_INSECURE_HTTP=true`, or the default seeded passwords are still present. A misconfigured secure system must fail loudly, not run insecurely.

### 14.6 Retention and durability

Clinical records retained per FMOH guidance (10 years adult, to age 21 paediatric) — retention is configuration, deletion is soft with a ledger entry, and the ledger itself is never deleted. `VACUUM INTO backups/gridvault_<ISO8601>.db` every 4 hours, plus before every migration and every key rotation, with a `SHA-256` manifest per backup. Retention: 7 daily, 4 weekly, 12 monthly. `npm run gv -- restore --file <backup>` verifies the manifest, restores to a scratch path, verifies the chain, and only then swaps. **A restore drill is part of the acceptance suite (AT-905), because an untested backup is not a backup.**

### 14.7 Logging and observability

Structured JSON logs via pino, with an automatic redaction serializer for known PHI keys. Log levels: `error` (needs a human), `warn` (degraded), `info` (state changes), `debug` (off in production). Metrics at `/api/health/metrics`: request rate and latency histograms per route, policy denials by `reason_code`, break-glass count, abuse alerts by rule, sync queue depth, anchor lag, chain verification duration and result. A ward node with no monitoring stack still keeps 7 days of rotated local logs.

---

## 15. Non-functional requirements

| ID     | Requirement                                               | Target                                                                                              |
| :----- | :-------------------------------------------------------- | :-------------------------------------------------------------------------------------------------- |
| NFR-1  | API latency, 500 patients, edge-class hardware            | roster p95 ≤ 150 ms; dossier p95 ≤ 200 ms; vitals write p95 ≤ 120 ms                                |
| NFR-2  | Break-glass end-to-end                                    | p95 ≤ 1000 ms from click to rendered chart                                                          |
| NFR-3  | Chain verification                                        | 50,000 entries < 5 s; streaming, memory ≤ 128 MB                                                    |
| NFR-4  | Availability of the ward terminal during a network outage | 100% for cached read + capture                                                                      |
| NFR-5  | Crash durability                                          | Kill `-9` mid-write loses no acknowledged write; chain verifies `HEALTHY` after restart             |
| NFR-6  | Concurrency                                               | 40 simultaneous terminals per node without `SQLITE_BUSY` errors surfacing to users                  |
| NFR-7  | Browser support                                           | Chrome/Edge ≥ 110, Firefox ≥ 115, Safari ≥ 16.4; Android tablet Chrome                              |
| NFR-8  | Accessibility                                             | WCAG 2.2 AA, zero axe-core violations on the five core screens                                      |
| NFR-9  | Cold start                                                | `docker compose up` to serving, seeded and verifiable, in ≤ 90 s on a 4-core laptop                 |
| NFR-10 | Test coverage                                             | ≥ 85% lines overall; 100% branch on `policy/`, `ledger/`, `crypto/`                                 |
| NFR-11 | Supply chain                                              | `npm audit --omit=dev` reports zero high/critical; dependencies pinned; lockfile committed          |
| NFR-12 | Localisation readiness                                    | All user-facing strings in `i18n/en.json`; no hard-coded strings in components (en-NG only shipped) |

---

## 16. Synthetic data

Synthetic, Synthea-shaped, Nigerian demographic distributions. No real person's data, ever, in any environment. `npm run gv -- seed --profile demo|load|empty`.

**Demo profile: 5 staff (§2), 12 patients across `ward_a`, `ward_b`, `icu`, `maternity`, `emergency`, `admissions`, ~200 historical vitals, ~40 ledger entries, 2 closed overrides, 1 resolved alert.** The four patients that the acceptance tests and the judge script depend on are fixed:

| ID                  | Name              | Ward / bed    | Age / sex | Status      | Diagnosis                                     | Genotype | HIV               | Notes                           | Role in the demo                                               |
| :------------------ | :---------------- | :------------ | :-------- | :---------- | :-------------------------------------------- | :------- | :---------------- | :------------------------------ | :------------------------------------------------------------- |
| `HOSP-LOS-2025-081` | Chinedu Nnamdi    | ward_a / A-04 | 42 M      | stable      | Post-op appendectomy day 2                    | Hb AA    | Non-reactive      | —                               | Baseline happy path; HR 78, BP 120/80, SpO₂ 98, 36.8 °C        |
| `HOSP-LOS-2025-082` | Amara Okafor      | ward_a / A-05 | 31 F      | observation | Gestational hypertension, pre-eclampsia watch | Hb AS    | Non-reactive      | G2 P1, 28 weeks                 | **Abuse-detection target.** HR 92, BP 158/95, SpO₂ 96, 37.2 °C |
| `HOSP-LOS-2025-083` | Funke Adeyemi     | ward_a / A-06 | 55 F      | stable      | T2DM with peripheral neuropathy               | Hb AA    | Non-reactive      | —                               | Redaction matrix control                                       |
| `HOSP-LOS-2025-084` | Babatunde Adeleke | icu / ICU-02  | 26 M      | critical    | Polytrauma, haemorrhagic shock post-RTA       | Hb SS    | Reactive (on ART) | Situational anxiety post-trauma | **Break-glass target.** HR 128, BP 85/50, SpO₂ 91, 38.4 °C     |

Load profile: 500 patients, 50,000 vitals, 50,000 ledger entries, for NFR-1 and NFR-3. Seed passwords are printed once to stdout, are random per run outside `DEMO_MODE`, and are refused at boot in production.

---

## 17. Delivery plan

| Phase | Deliverable                                                               | Gate                                                           |
| :---- | :------------------------------------------------------------------------ | :------------------------------------------------------------- |
| P0    | Workspace, toolchain, CI, remove the fake `npm test`                      | CI green on an empty suite; `npm test` fails when a test fails |
| P1    | Schema, migrations, seed, repositories, crypto module                     | AT-001…AT-012                                                  |
| P2    | Ledger + verification + anchoring + CLI verifier                          | AT-301…AT-315                                                  |
| P3    | Auth, sessions, rate limiting, idle lock                                  | AT-013…AT-025                                                  |
| P4    | Policy engine + redaction + records API                                   | AT-101…AT-119                                                  |
| P5    | Break-glass + notifier outbox + review                                    | AT-201…AT-212                                                  |
| P6    | Abuse engine + security console API + SSE                                 | AT-401…AT-409                                                  |
| P7    | Offline: cache, queue, heartbeat, sync, backfill                          | AT-501…AT-514                                                  |
| P8    | Frontend completion across all five surfaces; landing-page claims aligned | AT-601…AT-628                                                  |
| P9    | Docker, witness node, backups, restore drill, hardening, docs             | AT-901…AT-912                                                  |

Phases are ordered by dependency, not by demo value. The ledger precedes everything that must be logged; policy precedes the API that enforces it.

---

## 18. Risks and assumptions

| Risk                                                                   | Impact                                             | Mitigation                                                                                                                       |
| :--------------------------------------------------------------------- | :------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------- |
| SQLite write contention at 40 terminals                                | Failed writes at the bedside                       | WAL, `busy_timeout=5000`, short `IMMEDIATE` transactions, single-writer queue for the ledger append; load-tested in AT-906       |
| The witness node shares custody with the edge node in a small facility | T5 mitigation weakens to detection-by-honest-admin | Documented as a deployment requirement; console warns when the witness endpoint resolves to a private address on the same subnet |
| Staff routinise break-glass                                            | Control degrades into a habit                      | Frequency analytics, mandatory review queue, `RULE-ABUSE-04`, per-clinician monthly rate in the console                          |
| Device cache on a shared tablet                                        | PHI at rest on ward hardware                       | Encrypted store, in-memory key, purge on logout/lock/24h, no cross-ward caching                                                  |
| Clock drift after power loss                                           | Mis-ordered clinical timeline                      | `device_seq` ordering, dual timestamps, `CLOCK_SKEW_SUSPECT` flag, NTP on the node                                               |
| Argon2id on low-power edge hardware                                    | Slow logins                                        | Parameters are configurable with a documented floor; measured at boot and warned if login cost exceeds 500 ms                    |

**Assumptions** (stated, not discovered later): one facility per deployment; ≤ 500 concurrent inpatients and ≤ 40 terminals per node; staff have individual accounts (the product cannot fix shared logins if the facility refuses to provision); the ward node has a UPS; the witness node is under different administrative custody; Nigeria observes UTC+01:00 with no DST.

---

## 19. Definition of done

GridVault v2 is complete when, and only when:

1. Every acceptance test in AGENTS.md §9 passes in CI, on a clean clone, with no skips and no `.only`.
2. `docker compose up` on a fresh machine yields a seeded, usable system in ≤ 90 s, and the judge script in AGENTS.md §10 runs start to finish without a code change.
3. `npm run gv -- verify-ledger` on an exported ledger returns `HEALTHY`, and returns the exact broken index after `demo:tamper`.
4. Coverage gates in NFR-10 hold, `npm audit --omit=dev` is clean at high/critical, and the production config validator refuses every insecure configuration in §14.5.
5. `docs/DOWNTIME-SOP.md`, `docs/COMPLIANCE.md`, `docs/THREAT-MODEL.md`, `docs/OPERATIONS.md` and a printable triage slip exist, and the landing page claims nothing beyond them.
6. No placeholder, no mock data path, and no always-passing test remains anywhere in the repository.
