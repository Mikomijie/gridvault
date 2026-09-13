// Clinical repositories: clinical_data, vitals, clinical_notes, mar_entries.
// Hand-written SQL, always parameterised. Sensitive columns in
// clinical_data hold FieldCrypto ciphertext, never plaintext.

import type { GridVaultDatabase } from '../connection.js';

export interface ClinicalDataRow {
  patient_id: string;
  primary_diagnosis: string;
  allergies: string | null;
  medications_summary: string | null;
  hiv_status_enc: string;
  genotype_enc: string;
  pregnancy_status_enc: string | null;
  mental_health_notes_enc: string | null;
  key_version: number;
  version: number;
  updated_at: string;
}

export interface VitalsRow {
  id: string;
  patient_id: string;
  heart_rate: number;
  blood_pressure: string;
  spo2: number;
  temperature: number;
  respiratory_rate: number | null;
  pain_score: number | null;
  recorded_by: string;
  recorded_at: string;
  ingested_at: string;
  is_offline_sync: number;
  source: 'live' | 'offline_sync' | 'paper_backfill';
  device_id: string | null;
  device_seq: number | null;
  client_mutation_id: string | null;
  clock_skew_flag: number;
}

export interface ClinicalNoteRow {
  id: string;
  patient_id: string;
  author_staff_id: string;
  note_type: 'nursing' | 'medical' | 'handover' | 'psychiatric';
  body: string;
  written_at: string;
  ingested_at: string;
  source: string;
  client_mutation_id: string | null;
}

export interface MarEntryRow {
  id: string;
  patient_id: string;
  medication: string;
  dose: string;
  route: string;
  scheduled_at: string;
  administered_at: string | null;
  administered_by: string | null;
  witnessed_by: string | null;
  status: 'scheduled' | 'given' | 'held' | 'refused' | 'missed';
  source: string;
  client_mutation_id: string | null;
}

export function clinicalDataRepository(db: GridVaultDatabase) {
  return {
    insert(row: ClinicalDataRow): void {
      db.prepare(
        'INSERT INTO clinical_data (patient_id, primary_diagnosis, allergies, medications_summary, ' +
          'hiv_status_enc, genotype_enc, pregnancy_status_enc, mental_health_notes_enc, ' +
          'key_version, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        row.patient_id,
        row.primary_diagnosis,
        row.allergies,
        row.medications_summary,
        row.hiv_status_enc,
        row.genotype_enc,
        row.pregnancy_status_enc,
        row.mental_health_notes_enc,
        row.key_version,
        row.version,
        row.updated_at
      );
    },
    findByPatientId(patientId: string): ClinicalDataRow | undefined {
      return db.prepare('SELECT * FROM clinical_data WHERE patient_id = ?').get(patientId) as
        | ClinicalDataRow
        | undefined;
    }
  };
}

export function vitalsRepository(db: GridVaultDatabase) {
  return {
    insert(row: VitalsRow): void {
      db.prepare(
        'INSERT INTO vitals (id, patient_id, heart_rate, blood_pressure, spo2, temperature, ' +
          'respiratory_rate, pain_score, recorded_by, recorded_at, ingested_at, is_offline_sync, ' +
          'source, device_id, device_seq, client_mutation_id, clock_skew_flag) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        row.id,
        row.patient_id,
        row.heart_rate,
        row.blood_pressure,
        row.spo2,
        row.temperature,
        row.respiratory_rate,
        row.pain_score,
        row.recorded_by,
        row.recorded_at,
        row.ingested_at,
        row.is_offline_sync,
        row.source,
        row.device_id,
        row.device_seq,
        row.client_mutation_id,
        row.clock_skew_flag
      );
    },
    listLatestForPatient(patientId: string, limit: number): VitalsRow[] {
      return db
        .prepare('SELECT * FROM vitals WHERE patient_id = ? ORDER BY recorded_at DESC LIMIT ?')
        .all(patientId, limit) as VitalsRow[];
    },
    count(): number {
      const row = db.prepare('SELECT COUNT(*) AS n FROM vitals').get() as { n: number };
      return row.n;
    }
  };
}

export function clinicalNotesRepository(db: GridVaultDatabase) {
  return {
    insert(row: ClinicalNoteRow): void {
      db.prepare(
        'INSERT INTO clinical_notes (id, patient_id, author_staff_id, note_type, body, written_at, ' +
          'ingested_at, source, client_mutation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        row.id,
        row.patient_id,
        row.author_staff_id,
        row.note_type,
        row.body,
        row.written_at,
        row.ingested_at,
        row.source,
        row.client_mutation_id
      );
    },
    listForPatient(patientId: string): ClinicalNoteRow[] {
      return db
        .prepare('SELECT * FROM clinical_notes WHERE patient_id = ? ORDER BY written_at ASC')
        .all(patientId) as ClinicalNoteRow[];
    }
  };
}

export function marEntriesRepository(db: GridVaultDatabase) {
  return {
    insert(row: MarEntryRow): void {
      db.prepare(
        'INSERT INTO mar_entries (id, patient_id, medication, dose, route, scheduled_at, ' +
          'administered_at, administered_by, witnessed_by, status, source, client_mutation_id) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        row.id,
        row.patient_id,
        row.medication,
        row.dose,
        row.route,
        row.scheduled_at,
        row.administered_at,
        row.administered_by,
        row.witnessed_by,
        row.status,
        row.source,
        row.client_mutation_id
      );
    },
    listForPatient(patientId: string): MarEntryRow[] {
      return db
        .prepare('SELECT * FROM mar_entries WHERE patient_id = ? ORDER BY scheduled_at ASC')
        .all(patientId) as MarEntryRow[];
    }
  };
}
