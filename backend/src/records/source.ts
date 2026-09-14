// GridVault RecordSource (PRD 4.3).
//
// One interface with two implementations: SqliteRecordSource (shipped in
// v2 — GridVault is the system of record) and UpstreamRecordSource
// (interface + contract tests only — GridVault fronts an existing EMR and
// applies policy, redaction, logging and break-glass on the way out).
// Policy outcomes never depend on the implementation: AT-119 runs the same
// cases against both and requires identical decisions.

import type { GridVaultDatabase } from '../db/connection.js';
import {
  admissionsQueueRepository,
  careAssignmentsRepository,
  patientLogisticsRepository,
  patientsRepository,
  type PatientLogisticsRow,
  type PatientRow
} from '../db/repositories/patients.js';
import {
  clinicalDataRepository,
  clinicalNotesRepository,
  marEntriesRepository,
  vitalsRepository,
  type ClinicalDataRow,
  type ClinicalNoteRow,
  type MarEntryRow,
  type VitalsRow
} from '../db/repositories/clinical.js';

export interface PatientBundle {
  patient: PatientRow;
  logistics: PatientLogisticsRow | null;
  clinical: ClinicalDataRow | null;
  latestVitals: VitalsRow | null;
}

export interface RecordSource {
  readonly kind: 'sqlite' | 'upstream';
  findByHospitalNumber(hospitalNumber: string): PatientBundle | undefined;
  listByWard(ward: string): PatientRow[];
  listAll(): PatientRow[];
  vitalsHistory(patientId: string, limit: number): VitalsRow[];
  notesForPatient(patientId: string): ClinicalNoteRow[];
  marForPatient(patientId: string): MarEntryRow[];
  /** Open intake-queue patient ids for a clerk user id. */
  intakeQueuePatientIds(clerkUserId: string): string[];
  /** Wards the clerk can enumerate: own ward + wards of open queue patients. */
  clerkKnownWards(clerkUserId: string, clerkWard: string): string[];
}

export class SqliteRecordSource implements RecordSource {
  readonly kind = 'sqlite' as const;
  private readonly db: GridVaultDatabase;

  constructor(db: GridVaultDatabase) {
    this.db = db;
  }

  findByHospitalNumber(hospitalNumber: string): PatientBundle | undefined {
    const patient = patientsRepository(this.db).findByHospitalNumber(hospitalNumber);
    if (patient === undefined) {
      return undefined;
    }
    const logistics = patientLogisticsRepository(this.db).findByPatientId(patient.id) ?? null;
    const clinical = clinicalDataRepository(this.db).findByPatientId(patient.id) ?? null;
    const latest = vitalsRepository(this.db).listLatestForPatient(patient.id, 1)[0] ?? null;
    return { patient, logistics, clinical, latestVitals: latest };
  }

  listByWard(ward: string): PatientRow[] {
    return patientsRepository(this.db).listByWard(ward);
  }

  listAll(): PatientRow[] {
    return this.db.prepare('SELECT * FROM patients ORDER BY ward ASC, bed_number ASC').all() as PatientRow[];
  }

  vitalsHistory(patientId: string, limit: number): VitalsRow[] {
    return vitalsRepository(this.db).listLatestForPatient(patientId, limit);
  }

  notesForPatient(patientId: string): ClinicalNoteRow[] {
    return clinicalNotesRepository(this.db).listForPatient(patientId);
  }

  marForPatient(patientId: string): MarEntryRow[] {
    return marEntriesRepository(this.db).listForPatient(patientId);
  }

  intakeQueuePatientIds(clerkUserId: string): string[] {
    return admissionsQueueRepository(this.db)
      .listOpenForClerk(clerkUserId)
      .map((row) => row.patient_id);
  }

  clerkKnownWards(clerkUserId: string, clerkWard: string): string[] {
    const wards = new Set<string>([clerkWard]);
    const patients = patientsRepository(this.db);
    for (const row of careAssignmentsRepository(this.db).listActiveForUser(clerkUserId)) {
      const patient = patients.findById(row.patient_id);
      if (patient !== undefined) {
        wards.add(patient.ward);
      }
    }
    return [...wards];
  }
}
