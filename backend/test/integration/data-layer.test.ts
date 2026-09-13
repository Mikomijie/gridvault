import { cpSync, mkdtempSync, readFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FieldCrypto } from '../../src/crypto/field-encryption.js';
import { checksumMigration, migrate, MigrationError } from '../../src/db/migrate.js';
import { auditLogsRepository } from '../../src/db/repositories/ledger.js';
import { usersRepository } from '../../src/db/repositories/users.js';
import {
  admissionsQueueRepository,
  careAssignmentsRepository,
  patientsRepository
} from '../../src/db/repositories/patients.js';
import { clinicalDataRepository, vitalsRepository } from '../../src/db/repositories/clinical.js';
import { DEMO_PATIENTS, DEMO_STAFF, seedDatabase } from '../../src/db/seed.js';
import { MIGRATIONS_DIR, TEST_CLOCK, TEST_MASTER_KEY, migrateTestDb, openTestDb } from '../helpers/db.js';

const HASH_64_A = 'a'.repeat(64);
const HASH_64_B = 'b'.repeat(64);

function seedAuditRow(db: ReturnType<typeof openTestDb>, logIndexNote: string): void {
  auditLogsRepository(db).insert({
    timestamp: '2026-09-13T10:00:00.000+01:00',
    staff_id: 'GV-9042',
    staff_role: 'doctor',
    ward: 'icu',
    patient_id: 'SYSTEM',
    action: logIndexNote,
    details: '{}',
    session_id: null,
    terminal_id: null,
    source_ip: null,
    prev_hash: HASH_64_A,
    current_hash: HASH_64_B
  });
}

describe('data layer and crypto acceptance', () => {
  it('AT-008: migrate applied twice is idempotent, second run applies nothing, checksum recorded', () => {
    const db = openTestDb();
    try {
      const first = migrateTestDb(db);
      expect(first.applied).toEqual([1]);
      const second = migrateTestDb(db);
      expect(second.applied).toEqual([]);
      const rows = db
        .prepare('SELECT version, name, checksum FROM schema_migrations')
        .all() as Array<{ version: number; name: string; checksum: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.version).toBe(1);
      expect(rows[0]?.name).toBe('init');
      const sql = readFileSync(path.join(MIGRATIONS_DIR, '001_init.sql'), 'utf8');
      expect(rows[0]?.checksum).toBe(checksumMigration(sql));
      expect(rows[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      db.close();
    }
  });

  it('AT-009: altering a recorded migration file then re-running refuses and names the migration', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gv-migrations-'));
    cpSync(MIGRATIONS_DIR, dir, { recursive: true });
    const db = openTestDb();
    try {
      expect(migrate(db, { migrationsDir: dir, clock: TEST_CLOCK }).applied).toEqual([1]);
      appendFileSync(path.join(dir, '001_init.sql'), '\n-- attacker edit\n');
      let thrown: unknown;
      try {
        migrate(db, { migrationsDir: dir, clock: TEST_CLOCK });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(MigrationError);
      expect((thrown as MigrationError).migration).toBe('001_init.sql');
      expect((thrown as Error).message).toContain('001_init.sql');
    } finally {
      db.close();
    }
  });

  it('AT-010: UPDATE audit_logs SET staff_id via raw SQL aborts as append-only', () => {
    const db = openTestDb();
    try {
      migrateTestDb(db);
      seedAuditRow(db, 'LOGIN');
      seedAuditRow(db, 'VIEW_RECORD');
      let thrown: unknown;
      try {
        db.prepare("UPDATE audit_logs SET staff_id = 'x' WHERE log_index = 2").run();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeDefined();
      expect((thrown as { code?: string }).code ?? '').toContain('SQLITE_CONSTRAINT');
      expect((thrown as Error).message).toContain('audit_logs is append-only');
    } finally {
      db.close();
    }
  });

  it('AT-011: DELETE FROM audit_logs via raw SQL aborts as append-only', () => {
    const db = openTestDb();
    try {
      migrateTestDb(db);
      seedAuditRow(db, 'LOGIN');
      seedAuditRow(db, 'VIEW_RECORD');
      let thrown: unknown;
      try {
        db.prepare('DELETE FROM audit_logs WHERE log_index = 2').run();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeDefined();
      expect((thrown as { code?: string }).code ?? '').toContain('SQLITE_CONSTRAINT');
      expect((thrown as Error).message).toContain('audit_logs is append-only');
    } finally {
      db.close();
    }
  });

  it('AT-012: seed --profile demo creates exactly the 5 staff and 12 patients of PRD section 16', async () => {
    const db = openTestDb();
    try {
      const result = await seedDatabase(db, 'demo', {
        masterKey: TEST_MASTER_KEY,
        clock: TEST_CLOCK,
        hashStrength: 'fast'
      });
      expect(result.staff).toBe(5);
      expect(result.patients).toBe(12);

      const users = usersRepository(db);
      expect(users.count()).toBe(5);
      expect(users.listStaffIds()).toEqual(['AD-0012', 'GV-9042', 'GV-9101', 'RC-1029', 'SN-7742']);
      for (const expected of DEMO_STAFF) {
        const row = users.findByStaffId(expected.staffId);
        expect(row?.full_name).toBe(expected.fullName);
        expect(row?.role).toBe(expected.role);
        expect(row?.assigned_ward).toBe(expected.ward);
        expect(row?.assigned_shift).toBe(expected.shift);
        expect(row?.account_status).toBe('active');
      }

      const patients = patientsRepository(db);
      expect(patients.count()).toBe(12);
      expect(patients.listHospitalNumbers()).toEqual([
        'HOSP-LOS-2025-081',
        'HOSP-LOS-2025-082',
        'HOSP-LOS-2025-083',
        'HOSP-LOS-2025-084',
        'HOSP-LOS-2025-085',
        'HOSP-LOS-2025-086',
        'HOSP-LOS-2025-087',
        'HOSP-LOS-2025-088',
        'HOSP-LOS-2025-089',
        'HOSP-LOS-2025-090',
        'HOSP-LOS-2025-091',
        'HOSP-LOS-2025-092'
      ]);
      expect(DEMO_PATIENTS).toHaveLength(12);

      // The four named patients match PRD section 16 field-for-field.
      const crypto = new FieldCrypto(TEST_MASTER_KEY);
      const clinical = clinicalDataRepository(db);
      const vitals = vitalsRepository(db);
      const expectedVitals: Record<string, { hr: number; bp: string; spo2: number; temp: number }> = {
        'HOSP-LOS-2025-081': { hr: 78, bp: '120/80', spo2: 98, temp: 36.8 },
        'HOSP-LOS-2025-082': { hr: 92, bp: '158/95', spo2: 96, temp: 37.2 },
        'HOSP-LOS-2025-083': { hr: 76, bp: '130/84', spo2: 97, temp: 36.6 },
        'HOSP-LOS-2025-084': { hr: 128, bp: '85/50', spo2: 91, temp: 38.4 }
      };
      for (const number of Object.keys(expectedVitals)) {
        const spec = DEMO_PATIENTS.find((p) => p.hospitalNumber === number);
        const row = patients.findByHospitalNumber(number);
        expect(row?.full_name).toBe(spec?.fullName);
        expect(row?.age).toBe(spec?.age);
        expect(row?.gender).toBe(spec?.gender);
        expect(row?.ward).toBe(spec?.ward);
        expect(row?.bed_number).toBe(spec?.bed);
        expect(row?.status).toBe(spec?.status);
        const data = clinical.findByPatientId(row?.id as string);
        expect(data?.primary_diagnosis).toBe(spec?.diagnosis);
        expect(data?.allergies).toBe(spec?.allergies);
        expect(data?.medications_summary).toBe(spec?.medications);
        expect(crypto.decryptField(row?.id as string, 'hiv_status', data?.hiv_status_enc as string)).toBe(
          spec?.hiv
        );
        expect(crypto.decryptField(row?.id as string, 'genotype', data?.genotype_enc as string)).toBe(
          spec?.genotype
        );
        const want = expectedVitals[number] as { hr: number; bp: string; spo2: number; temp: number };
        const latest = vitals.listLatestForPatient(row?.id as string, 1)[0];
        expect(latest?.heart_rate).toBe(want.hr);
        expect(latest?.blood_pressure).toBe(want.bp);
        expect(latest?.spo2).toBe(want.spo2);
        expect(latest?.temperature).toBe(want.temp);
      }

      // Clerk RC-1029's intake queue holds his patients and excludes HOSP-LOS-2025-082.
      const clerk = users.findByStaffId('RC-1029');
      const queueRows = admissionsQueueRepository(db).listOpenForClerk(clerk?.id as string);
      const queueNumbers = queueRows
        .map((q) => patients.findById(q.patient_id)?.hospital_number as string)
        .sort();
      expect(queueNumbers).toEqual(['HOSP-LOS-2025-081', 'HOSP-LOS-2025-091', 'HOSP-LOS-2025-092']);
      expect(queueNumbers).not.toContain('HOSP-LOS-2025-082');

      // Ward A patients carry a nurse_of_record assignment for SN-7742.
      const nurse = users.findByStaffId('SN-7742');
      const assignments = careAssignmentsRepository(db).listActiveForUser(nurse?.id as string);
      const assignedNumbers = assignments
        .map((a) => patients.findById(a.patient_id)?.hospital_number as string)
        .sort();
      expect(assignedNumbers).toContain('HOSP-LOS-2025-081');
      expect(assignedNumbers).toContain('HOSP-LOS-2025-082');
      expect(assignedNumbers).toContain('HOSP-LOS-2025-083');
    } finally {
      db.close();
    }
  });

  it('seed --profile empty migrates the schema with zero rows', async () => {
    const db = openTestDb();
    try {
      const result = await seedDatabase(db, 'empty', {
        masterKey: TEST_MASTER_KEY,
        clock: TEST_CLOCK
      });
      expect(result).toEqual({ profile: 'empty', staff: 0, patients: 0, vitals: 0 });
      expect(usersRepository(db).count()).toBe(0);
      expect(patientsRepository(db).count()).toBe(0);
    } finally {
      db.close();
    }
  });
});
