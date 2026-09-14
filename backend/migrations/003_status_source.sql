-- GridVault migration 003_status_source
-- PRD section 12.7: the auto-triage status recomputed on every vitals write
-- must never suppress a manual clinician-set status. The patients row now
-- records which path set the status and who set it; vitals writes recompute
-- only when status_source = 'auto'.
ALTER TABLE patients ADD COLUMN status_source TEXT NOT NULL DEFAULT 'auto'
  CHECK (status_source IN ('auto', 'manual'));
ALTER TABLE patients ADD COLUMN status_set_by TEXT REFERENCES users(staff_id);
