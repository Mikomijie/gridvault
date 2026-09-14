// Break-glass repository: emergency_overrides.
// Hand-written SQL, always parameterised. Lifecycle transitions
// (ACTIVE -> EXPIRED | CLOSED | REVOKED) are owned by the P5 override
// service; this module is storage only.

import type { GridVaultDatabase } from '../connection.js';

export type OverrideState = 'ACTIVE' | 'EXPIRED' | 'CLOSED' | 'REVOKED';
export type OverrideReviewState = 'PENDING_REVIEW' | 'ACKNOWLEDGED' | 'ESCALATED';

export interface EmergencyOverrideRow {
  id: string;
  audit_log_index: number;
  staff_id: string;
  patient_id: string;
  ward: string;
  justification_code: string;
  justification_notes: string | null;
  state: OverrideState;
  granted_at: string;
  expires_at: string;
  closed_at: string | null;
  revoked_by: string | null;
  revoked_reason: string | null;
  review_state: OverrideReviewState;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_offline: number;
  created_at: string;
}

export function emergencyOverridesRepository(db: GridVaultDatabase) {
  return {
    insert(row: EmergencyOverrideRow): void {
      db.prepare(
        'INSERT INTO emergency_overrides (id, audit_log_index, staff_id, patient_id, ward, ' +
          'justification_code, justification_notes, state, granted_at, expires_at, closed_at, ' +
          'revoked_by, revoked_reason, review_state, reviewed_by, reviewed_at, review_notes, ' +
          'created_offline, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        row.id,
        row.audit_log_index,
        row.staff_id,
        row.patient_id,
        row.ward,
        row.justification_code,
        row.justification_notes,
        row.state,
        row.granted_at,
        row.expires_at,
        row.closed_at,
        row.revoked_by,
        row.revoked_reason,
        row.review_state,
        row.reviewed_by,
        row.reviewed_at,
        row.review_notes,
        row.created_offline,
        row.created_at
      );
    },
    findById(id: string): EmergencyOverrideRow | undefined {
      return db.prepare('SELECT * FROM emergency_overrides WHERE id = ?').get(id) as
        | EmergencyOverrideRow
        | undefined;
    },
    listActiveForStaffPatient(staffId: string, patientId: string, at: string): EmergencyOverrideRow[] {
      return db
        .prepare(
          "SELECT * FROM emergency_overrides WHERE staff_id = ? AND patient_id = ? AND state = 'ACTIVE' AND expires_at > ?"
        )
        .all(staffId, patientId, at) as EmergencyOverrideRow[];
    },
    listActiveForStaff(staffId: string): EmergencyOverrideRow[] {
      return db
        .prepare(
          "SELECT * FROM emergency_overrides WHERE staff_id = ? AND state = 'ACTIVE' ORDER BY granted_at DESC"
        )
        .all(staffId) as EmergencyOverrideRow[];
    },
  };
}
