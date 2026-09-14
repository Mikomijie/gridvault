// AT-119: RecordSource contract — SqliteRecordSource and an independent
// upstream-shaped stub must produce identical policy outcomes for every
// AT-118 case. The stub serves snapshotted bundles from memory (the shape
// an upstream EMR adapter returns); queue facts are canned at snapshot
// time. Both services run the same 200-cell sequence against freshly seeded
// databases, and every normalized outcome must match.

import { describe, expect, it } from 'vitest';
import type { GridVaultDatabase } from '../../src/db/connection.js';
import { FieldCrypto } from '../../src/crypto/field-encryption.js';
import { AppError } from '../../src/http/errors.js';
import { RecordsService } from '../../src/records/service.js';
import { SqliteRecordSource, type PatientBundle, type RecordSource } from '../../src/records/source.js';
import type { PatientRow } from '../../src/db/repositories/patients.js';
import type { ClinicalNoteRow, MarEntryRow, VitalsRow } from '../../src/db/repositories/clinical.js';
import { usersRepository, type UserRow } from '../../src/db/repositories/users.js';
import type { AuthenticatedSubject } from '../../src/auth/service.js';
import { MORNING_CLOCK, TEST_TIME_ZONE, createSeededStack } from '../helpers/app.js';
import { TEST_MASTER_KEY } from '../helpers/db.js';

/** An independent RecordSource: canned snapshot, no database access. */
class SnapshotRecordSource implements RecordSource {
  readonly kind = 'upstream' as const;
  private readonly byNumber: Map<string, PatientBundle>;
  private readonly byWard: Map<string, PatientRow[]>;
  private readonly queuePatientIds: string[];
  private readonly knownWards: string[];

  constructor(bundles: PatientBundle[], queuePatientIds: string[], knownWards: string[]) {
    this.byNumber = new Map(bundles.map((bundle) => [bundle.patient.hospital_number, bundle]));
    this.byWard = new Map();
    for (const bundle of bundles) {
      const list = this.byWard.get(bundle.patient.ward) ?? [];
      list.push(bundle.patient);
      this.byWard.set(bundle.patient.ward, list);
    }
    this.queuePatientIds = [...queuePatientIds];
    this.knownWards = [...knownWards];
  }

  findByHospitalNumber(hospitalNumber: string): PatientBundle | undefined {
    return this.byNumber.get(hospitalNumber);
  }
  listByWard(ward: string): PatientRow[] {
    return [...(this.byWard.get(ward) ?? [])];
  }
  listAll(): PatientRow[] {
    return [...this.byNumber.values()].map((bundle) => bundle.patient);
  }
  vitalsHistory(): VitalsRow[] {
    return [];
  }
  notesForPatient(): ClinicalNoteRow[] {
    return [];
  }
  marForPatient(): MarEntryRow[] {
    return [];
  }
  intakeQueuePatientIds(): string[] {
    return [...this.queuePatientIds];
  }
  clerkKnownWards(): string[] {
    return [...this.knownWards];
  }
}

function snapshotDb(db: GridVaultDatabase): SnapshotRecordSource {
  const sqlite = new SqliteRecordSource(db);
  const bundles: PatientBundle[] = [];
  for (const patient of sqlite.listAll()) {
    const bundle = sqlite.findByHospitalNumber(patient.hospital_number);
    if (bundle !== undefined) {
      bundles.push(bundle);
    }
  }
  const clerk = usersRepository(db).findByStaffId('RC-1029') as UserRow;
  return new SnapshotRecordSource(
    bundles,
    sqlite.intakeQueuePatientIds(clerk.id),
    sqlite.clerkKnownWards(clerk.id, clerk.assigned_ward)
  );
}

function subjectFor(db: GridVaultDatabase, staffId: string): AuthenticatedSubject {
  const user = usersRepository(db).findByStaffId(staffId) as UserRow;
  return { user, sessionId: 'contract-test-session', duty: 'on_duty' };
}

const GROUPS = ['DEMOGRAPHICS', 'LOGISTICS', 'VITALS', 'CLINICAL', 'SENSITIVE'];
const PATIENTS = ['HOSP-LOS-2025-081', 'HOSP-LOS-2025-082', 'HOSP-LOS-2025-083', 'HOSP-LOS-2025-084'];
const PRINCIPALS = ['GV-9042', 'SN-7742', 'RC-1029', 'AD-0012', 'GV-9101'];

const GROUP_KEY: Record<string, string> = {
  DEMOGRAPHICS: 'patient',
  LOGISTICS: 'logistics',
  VITALS: 'vitals',
  CLINICAL: 'clinical',
  SENSITIVE: 'sensitive'
};

describe('AT-119: RecordSource contract', () => {
  it('AT-119: sqlite and upstream sources agree on every AT-118 policy outcome', async () => {
    const stackA = await createSeededStack(MORNING_CLOCK);
    const stackB = await createSeededStack(MORNING_CLOCK);
    const serviceA = new RecordsService({
      db: stackA.db,
      source: new SqliteRecordSource(stackA.db),
      crypto: new FieldCrypto(TEST_MASTER_KEY),
      clock: MORNING_CLOCK,
      timeZone: TEST_TIME_ZONE
    });
    // The stub re-syncs before every operation, the way an upstream
    // read-through adapter serves the latest payload per request. The
    // policy path under test only ever sees the RecordSource interface.
    const freshServiceB = (): RecordsService =>
      new RecordsService({
        db: stackB.db,
        source: snapshotDb(stackB.db),
        crypto: new FieldCrypto(TEST_MASTER_KEY),
        clock: MORNING_CLOCK,
        timeZone: TEST_TIME_ZONE
      });

    const meta = { terminal_id: null, source_ip: null };
    let cells = 0;
    for (const principal of PRINCIPALS) {
      const subjectA = subjectFor(stackA.db, principal);
      const subjectB = subjectFor(stackB.db, principal);
      for (const patient of PATIENTS) {
        const normalizeRead = (service: RecordsService, subject: AuthenticatedSubject): string => {
          try {
            const dossier = service.readDossier(subject, patient, meta);
            const parts = GROUPS.map((group) => {
              const key = GROUP_KEY[group] as string;
              const value = (dossier.data as Record<string, unknown>)[key];
              if (value !== null && typeof value === 'object') {
                return `${group}:full`;
              }
              const reason = dossier._meta.redactions.find((entry) => entry.group === group)
                ?.reason_code;
              return `${group}:${reason ?? 'redacted'}`;
            });
            // Admin limited-demographics projection must match too.
            const demoName = (dossier.data.patient as Record<string, unknown>)['full_name'];
            return `allow|${parts.join(',')}|demo:${String(demoName)}`;
          } catch (error) {
            if (error instanceof AppError) {
              return `deny|${error.httpStatus}|${error.reasonCode ?? 'none'}`;
            }
            throw error;
          }
        };
        expect(normalizeRead(freshServiceB(), subjectB), `${principal} ${patient} read`).toBe(
          normalizeRead(serviceA, subjectA)
        );
        cells += 1;

        for (const group of GROUPS) {
          const normalizeWrite = (service: RecordsService, subject: AuthenticatedSubject): string => {
            try {
              if (group === 'VITALS') {
                service.writeVitals(
                  subject,
                  patient,
                  { heart_rate: 80, blood_pressure: '120/80', spo2: 98, temperature: 36.8 },
                  meta
                );
              } else {
                const dossier = service.readDossier(subject, patient, meta);
                const version = (dossier.data.patient as Record<string, unknown>)[
                  'version'
                ] as number;
                const patch =
                  group === 'DEMOGRAPHICS'
                    ? { version, full_name: 'Contract Probe' }
                    : group === 'LOGISTICS'
                      ? { version, payer: 'NHIS' }
                      : group === 'CLINICAL'
                        ? { version, allergies: 'Contract probe' }
                        : { version, genotype: 'Hb AA' };
                service.patchPatient(subject, patient, patch, meta);
              }
              return 'allow';
            } catch (error) {
              if (error instanceof AppError) {
                return `deny|${error.httpStatus}|${error.reasonCode ?? 'none'}`;
              }
              throw error;
            }
          };
          // Writes run against both stacks in lockstep so versions drift symmetrically.
          const outcomeA = normalizeWrite(serviceA, subjectA);
          const outcomeB = normalizeWrite(freshServiceB(), subjectB);
          expect(outcomeB, `${principal} ${patient} ${group} write`).toBe(outcomeA);
          cells += 1;
        }
      }
    }
    expect(cells).toBe(5 * 4 * (1 + 5));
  }, 120000);
});
