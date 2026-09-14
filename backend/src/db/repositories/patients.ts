// Patient repositories: patients, patient_logistics, care_assignments,
// admissions_queue. Hand-written SQL, always parameterised.

import type { GridVaultDatabase } from '../connection.js';

export type PatientStatus = 'stable' | 'observation' | 'critical' | 'discharged';

export interface PatientRow {
  id: string;
  hospital_number: string;
  full_name: string;
  age: number;
  gender: 'male' | 'female';
  ward: string;
  bed_number: string;
  status: PatientStatus;
  /** 'auto' (triage derivation) or 'manual' (clinician override). Migration 003. */
  status_source: 'auto' | 'manual';
  status_set_by: string | null;
  admission_date: string;
  admitted_by: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface PatientLogisticsRow {
  patient_id: string;
  next_of_kin: string | null;
  contact_phone: string | null;
  address_lga: string | null;
  payer: string | null;
  admission_source: string | null;
  updated_at: string;
}

export type CareRelationship = 'attending' | 'nurse_of_record' | 'consulting' | 'intake_clerk';

export interface CareAssignmentRow {
  id: string;
  patient_id: string;
  user_id: string;
  relationship: CareRelationship;
  active_from: string;
  active_to: string | null;
  assigned_by: string;
  created_at: string;
}

export interface AdmissionsQueueRow {
  id: string;
  patient_id: string;
  clerk_id: string;
  opened_at: string;
  closed_at: string | null;
}

export function patientsRepository(db: GridVaultDatabase) {
  return {
    insert(row: PatientRow): void {
      db.prepare(
        'INSERT INTO patients (id, hospital_number, full_name, age, gender, ward, bed_number, ' +
          'status, admission_date, admitted_by, version, created_at, updated_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        row.id,
        row.hospital_number,
        row.full_name,
        row.age,
        row.gender,
        row.ward,
        row.bed_number,
        row.status,
        row.admission_date,
        row.admitted_by,
        row.version,
        row.created_at,
        row.updated_at
      );
    },
    findByHospitalNumber(hospitalNumber: string): PatientRow | undefined {
      return db.prepare('SELECT * FROM patients WHERE hospital_number = ?').get(hospitalNumber) as
        | PatientRow
        | undefined;
    },
    findById(id: string): PatientRow | undefined {
      return db.prepare('SELECT * FROM patients WHERE id = ?').get(id) as PatientRow | undefined;
    },
    count(): number {
      const row = db.prepare('SELECT COUNT(*) AS n FROM patients').get() as { n: number };
      return row.n;
    },
    listHospitalNumbers(): string[] {
      const rows = db
        .prepare('SELECT hospital_number FROM patients ORDER BY hospital_number ASC')
        .all() as Array<{ hospital_number: string }>;
      return rows.map((r) => r.hospital_number);
    },
    listByWard(ward: string): PatientRow[] {
      return db.prepare('SELECT * FROM patients WHERE ward = ?').all(ward) as PatientRow[];
    }
  };
}

export function patientLogisticsRepository(db: GridVaultDatabase) {
  return {
    insert(row: PatientLogisticsRow): void {
      db.prepare(
        'INSERT INTO patient_logistics (patient_id, next_of_kin, contact_phone, address_lga, ' +
          'payer, admission_source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(
        row.patient_id,
        row.next_of_kin,
        row.contact_phone,
        row.address_lga,
        row.payer,
        row.admission_source,
        row.updated_at
      );
    },
    findByPatientId(patientId: string): PatientLogisticsRow | undefined {
      return db.prepare('SELECT * FROM patient_logistics WHERE patient_id = ?').get(patientId) as
        | PatientLogisticsRow
        | undefined;
    }
  };
}

export function careAssignmentsRepository(db: GridVaultDatabase) {
  return {
    insert(row: CareAssignmentRow): void {
      db.prepare(
        'INSERT INTO care_assignments (id, patient_id, user_id, relationship, active_from, active_to, ' +
          'assigned_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        row.id,
        row.patient_id,
        row.user_id,
        row.relationship,
        row.active_from,
        row.active_to,
        row.assigned_by,
        row.created_at
      );
    },
    listActiveForUser(userId: string): CareAssignmentRow[] {
      return db
        .prepare('SELECT * FROM care_assignments WHERE user_id = ? AND active_to IS NULL')
        .all(userId) as CareAssignmentRow[];
    }
  };
}

export function admissionsQueueRepository(db: GridVaultDatabase) {
  return {
    insert(row: AdmissionsQueueRow): void {
      db.prepare(
        'INSERT INTO admissions_queue (id, patient_id, clerk_id, opened_at, closed_at) ' +
          'VALUES (?, ?, ?, ?, ?)'
      ).run(row.id, row.patient_id, row.clerk_id, row.opened_at, row.closed_at);
    },
    listOpenForClerk(clerkId: string): AdmissionsQueueRow[] {
      return db
        .prepare('SELECT * FROM admissions_queue WHERE clerk_id = ? AND closed_at IS NULL')
        .all(clerkId) as AdmissionsQueueRow[];
    }
  };
}
