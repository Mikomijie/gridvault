-- GridVault migration 002_anchor_facility
-- The PRD section 8.6 anchor receipt is facility-scoped, but 001 did not
-- persist facility_id on chain_anchors, so the node could not round-trip
-- what it signed (export, console history). Forward-only delta: existing
-- rows keep 'unknown' rather than a fabricated facility; all new inserts
-- carry the real facility id.
ALTER TABLE chain_anchors ADD COLUMN facility_id TEXT NOT NULL DEFAULT 'unknown';
