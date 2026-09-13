-- GridVault migration 001_init
-- Authoritative source: PRD.md section 11 (verbatim).
-- Creates the full schema including the two append-only triggers on audit_logs.
-- Applied transactionally by src/db/migrate.ts with a recorded SHA-256 checksum.

-- Identity ----------------------------------------------------------------
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

-- Patients -----------------------------------------------------------------
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

-- Clinical -----------------------------------------------------------------
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

-- Ledger -------------------------------------------------------------------
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

-- Break-glass ---------------------------------------------------------------
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

-- Security ------------------------------------------------------------------
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
