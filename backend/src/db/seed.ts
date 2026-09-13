// GridVault seeder: demo | load | empty profiles (PRD section 16).
//
// All data is synthetic. Phone numbers use the 000 range so they can never
// be mistaken for real subscriber numbers. Demo passwords/PINs are
// deterministic and documented; production refuses to boot with seeded
// credentials (P3/P9 config gate).
//
// Demo history rows for the ledger, overrides and alerts are NOT created
// here: those tables are written exclusively through the P2 ledger append
// path, the P5 override service and the P6 abuse engine, none of which
// exists yet. Raw-inserting them now would bypass the controls those
// phases prove. See docs/DECISIONS.md.

import argon2 from 'argon2';
import { v7 as uuidv7 } from 'uuid';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { GridVaultDatabase } from './connection.js';
import { formatIsoWithOffset, systemClock, type Clock } from '../clock.js';
import { FieldCrypto } from '../crypto/field-encryption.js';
import { migrate } from './migrate.js';
import {
  usersRepository,
  type AssignedShift,
  type UserRole
} from './repositories/users.js';
import {
  admissionsQueueRepository,
  careAssignmentsRepository,
  patientLogisticsRepository,
  patientsRepository,
  type PatientStatus
} from './repositories/patients.js';
import {
  clinicalDataRepository,
  clinicalNotesRepository,
  marEntriesRepository,
  vitalsRepository
} from './repositories/clinical.js';

export type SeedProfile = 'demo' | 'load' | 'empty';

export interface SeedOptions {
  masterKey: Uint8Array;
  now?: Date;
  clock?: Clock;
  timeZone?: string;
  migrationsDir?: string;
  /** 'fast' uses minimal argon2 costs for tests; 'standard' uses PRD section 6.6. */
  hashStrength?: 'standard' | 'fast';
}

export interface SeedResult {
  profile: SeedProfile;
  staff: number;
  patients: number;
  vitals: number;
}

export const TIME_ZONE = 'Africa/Lagos';

/** Deterministic demo password for a staff member. Demo only, never production. */
export function demoPasswordFor(staffId: string): string {
  return `GridVault-Demo-${staffId}!`;
}

/** Deterministic demo PINs (4-6 digits). Demo only, never production. */
export const DEMO_PINS: Record<string, string> = {
  'GV-9042': '220042',
  'SN-7742': '220774',
  'GV-9101': '220901',
  'AD-0012': '220012',
  'RC-1029': '221029'
};

interface SeedStaff {
  staffId: string;
  fullName: string;
  role: UserRole;
  ward: string;
  shift: AssignedShift;
}

/** The 5 staff of PRD section 2, exactly. */
export const DEMO_STAFF: SeedStaff[] = [
  { staffId: 'GV-9042', fullName: 'Olumide Adeyemi', role: 'doctor', ward: 'icu', shift: 'morning' },
  { staffId: 'SN-7742', fullName: 'Chioma Okonkwo', role: 'nurse', ward: 'ward_a', shift: 'morning' },
  { staffId: 'RC-1029', fullName: 'Ibrahim Danjuma', role: 'clerk', ward: 'admissions', shift: 'afternoon' },
  { staffId: 'AD-0012', fullName: 'Kemi Balogun', role: 'admin', ward: 'administration', shift: 'morning' },
  { staffId: 'GV-9101', fullName: 'Ngozi Eze', role: 'cmo', ward: 'administration', shift: 'morning' }
];

export interface SeedPatientSpec {
  hospitalNumber: string;
  fullName: string;
  age: number;
  gender: 'male' | 'female';
  ward: string;
  bed: string;
  status: PatientStatus;
  admittedDaysAgo: number;
  diagnosis: string;
  allergies: string | null;
  medications: string | null;
  hiv: string;
  genotype: string;
  pregnancy: string | null;
  mentalHealth: string | null;
  vitals: { hr: number; bp: string; spo2: number; temp: number };
  nextOfKin: string;
  lga: string;
  payer: string;
  admissionSource: string;
}

/**
 * The 12 demo patients. The first four are the fixed acceptance-test
 * patients of PRD section 16; the remaining eight are synthetic controls
 * covering ward_b, maternity, emergency and admissions.
 *
 * HIV note: PRD section 16 describes HOSP-LOS-2025-084 as "Reactive (on
 * ART)". The acceptance suite (AT-116) names the seed plaintext
 * "Reactive (Confirmed)", and acceptance tests win over prose per the
 * precedence rule, so the stored value is "Reactive (Confirmed)" with the
 * ART regimen recorded in medications_summary.
 */
export const DEMO_PATIENTS: SeedPatientSpec[] = [
  {
    hospitalNumber: 'HOSP-LOS-2025-081',
    fullName: 'Chinedu Nnamdi',
    age: 42,
    gender: 'male',
    ward: 'ward_a',
    bed: 'A-04',
    status: 'stable',
    admittedDaysAgo: 2,
    diagnosis: 'Post-op appendectomy day 2',
    allergies: 'Penicillin (rash)',
    medications: 'Paracetamol 1g Q6H PO; Ceftriaxone 1g BD IV',
    hiv: 'Non-reactive',
    genotype: 'Hb AA',
    pregnancy: 'Not applicable',
    mentalHealth: null,
    vitals: { hr: 78, bp: '120/80', spo2: 98, temp: 36.8 },
    nextOfKin: 'Ngozi Nnamdi (spouse)',
    lga: 'Ikeja',
    payer: 'NHIS',
    admissionSource: 'Emergency'
  },
  {
    hospitalNumber: 'HOSP-LOS-2025-082',
    fullName: 'Amara Okafor',
    age: 31,
    gender: 'female',
    ward: 'ward_a',
    bed: 'A-05',
    status: 'observation',
    admittedDaysAgo: 1,
    diagnosis: 'Gestational hypertension, pre-eclampsia watch',
    allergies: null,
    medications: 'Methyldopa 250mg TDS PO; Nifedipine 20mg BD PO',
    hiv: 'Non-reactive',
    genotype: 'Hb AS',
    pregnancy: 'Pregnant - G2 P1, 28 weeks gestation',
    mentalHealth: 'Anxiety related to high-risk pregnancy. Counselling offered.',
    vitals: { hr: 92, bp: '158/95', spo2: 96, temp: 37.2 },
    nextOfKin: 'Emeka Okafor (spouse)',
    lga: 'Surulere',
    payer: 'Out-of-pocket',
    admissionSource: 'Antenatal clinic'
  },
  {
    hospitalNumber: 'HOSP-LOS-2025-083',
    fullName: 'Funke Adeyemi',
    age: 55,
    gender: 'female',
    ward: 'ward_a',
    bed: 'A-06',
    status: 'stable',
    admittedDaysAgo: 3,
    diagnosis: 'T2DM with peripheral neuropathy',
    allergies: 'Sulfa drugs (hives)',
    medications: 'Metformin 500mg BD PO; Gabapentin 300mg nocte PO',
    hiv: 'Non-reactive',
    genotype: 'Hb AA',
    pregnancy: 'Post-menopausal - not pregnant',
    mentalHealth: null,
    vitals: { hr: 76, bp: '130/84', spo2: 97, temp: 36.6 },
    nextOfKin: 'Tunde Adeyemi (son)',
    lga: 'Ikorodu',
    payer: 'NHIS',
    admissionSource: 'Medical OPD'
  },
  {
    hospitalNumber: 'HOSP-LOS-2025-084',
    fullName: 'Babatunde Adeleke',
    age: 26,
    gender: 'male',
    ward: 'icu',
    bed: 'ICU-02',
    status: 'critical',
    admittedDaysAgo: 0,
    diagnosis: 'Polytrauma, haemorrhagic shock post-RTA',
    allergies: null,
    medications: 'IV Ceftriaxone 2g daily; ART continued: TDF/3TC/DTG - on ART',
    hiv: 'Reactive (Confirmed)',
    genotype: 'Hb SS',
    pregnancy: 'Not applicable',
    mentalHealth: 'Situational anxiety post-trauma; nightmares since RTA. Review by psychiatry requested.',
    vitals: { hr: 128, bp: '85/50', spo2: 91, temp: 38.4 },
    nextOfKin: 'Aisha Adeleke (sister)',
    lga: 'Agege',
    payer: 'Out-of-pocket',
    admissionSource: 'Emergency'
  },
  {
    hospitalNumber: 'HOSP-LOS-2025-085',
    fullName: 'Tolu Bakare',
    age: 29,
    gender: 'female',
    ward: 'maternity',
    bed: 'M-01',
    status: 'stable',
    admittedDaysAgo: 1,
    diagnosis: 'Spontaneous vaginal delivery, live female infant',
    allergies: null,
    medications: 'Ferrous sulphate 200mg daily PO',
    hiv: 'Non-reactive',
    genotype: 'Hb AA',
    pregnancy: 'Delivered - P2, postpartum day 1',
    mentalHealth: null,
    vitals: { hr: 84, bp: '118/76', spo2: 98, temp: 36.9 },
    nextOfKin: 'Seun Bakare (spouse)',
    lga: 'Lekki',
    payer: 'NHIS',
    admissionSource: 'Labour ward'
  },
  {
    hospitalNumber: 'HOSP-LOS-2025-086',
    fullName: 'Yusuf Abdullahi',
    age: 61,
    gender: 'male',
    ward: 'ward_b',
    bed: 'B-02',
    status: 'observation',
    admittedDaysAgo: 2,
    diagnosis: 'Community-acquired pneumonia',
    allergies: 'None known',
    medications: 'Amoxicillin-clavulanate 625mg BD PO',
    hiv: 'Non-reactive',
    genotype: 'Hb AA',
    pregnancy: 'Not applicable',
    mentalHealth: null,
    vitals: { hr: 98, bp: '132/86', spo2: 94, temp: 38.1 },
    nextOfKin: 'Fatima Abdullahi (daughter)',
    lga: 'Mushin',
    payer: 'Out-of-pocket',
    admissionSource: 'Medical OPD'
  },
  {
    hospitalNumber: 'HOSP-LOS-2025-087',
    fullName: 'Grace Ezeani',
    age: 24,
    gender: 'female',
    ward: 'maternity',
    bed: 'M-03',
    status: 'observation',
    admittedDaysAgo: 0,
    diagnosis: 'Preterm labour, 34 weeks, steroids commenced',
    allergies: null,
    medications: 'Dexamethasone 6mg Q12H IM x4 doses',
    hiv: 'Non-reactive',
    genotype: 'Hb AS',
    pregnancy: 'Pregnant - G1 P0, 34 weeks gestation',
    mentalHealth: null,
    vitals: { hr: 96, bp: '122/80', spo2: 98, temp: 37.0 },
    nextOfKin: 'Obi Ezeani (spouse)',
    lga: 'Badagry',
    payer: 'NHIS',
    admissionSource: 'Emergency'
  },
  {
    hospitalNumber: 'HOSP-LOS-2025-088',
    fullName: 'Kabiru Sule',
    age: 47,
    gender: 'male',
    ward: 'ward_b',
    bed: 'B-05',
    status: 'stable',
    admittedDaysAgo: 4,
    diagnosis: 'Cellulitis left lower limb, improving on antibiotics',
    allergies: null,
    medications: 'Flucloxacillin 500mg QDS PO',
    hiv: 'Non-reactive',
    genotype: 'Hb AA',
    pregnancy: 'Not applicable',
    mentalHealth: null,
    vitals: { hr: 82, bp: '126/82', spo2: 97, temp: 37.1 },
    nextOfKin: 'Halima Sule (spouse)',
    lga: 'Oshodi',
    payer: 'Out-of-pocket',
    admissionSource: 'Surgical OPD'
  },
  {
    hospitalNumber: 'HOSP-LOS-2025-089',
    fullName: 'Adaeze Nwosu',
    age: 19,
    gender: 'female',
    ward: 'emergency',
    bed: 'E-01',
    status: 'observation',
    admittedDaysAgo: 0,
    diagnosis: 'Acute asthma exacerbation, responding to nebulisation',
    allergies: 'NSAIDs (bronchospasm)',
    medications: 'Salbutamol nebulisation Q4H; Prednisolone 40mg daily PO',
    hiv: 'Non-reactive',
    genotype: 'Hb AA',
    pregnancy: 'Not pregnant',
    mentalHealth: null,
    vitals: { hr: 108, bp: '124/78', spo2: 93, temp: 37.3 },
    nextOfKin: 'Chiamaka Nwosu (sister)',
    lga: 'Yaba',
    payer: 'Out-of-pocket',
    admissionSource: 'Self-referral'
  },
  {
    hospitalNumber: 'HOSP-LOS-2025-090',
    fullName: 'Ibrahim Musa',
    age: 53,
    gender: 'male',
    ward: 'icu',
    bed: 'ICU-04',
    status: 'critical',
    admittedDaysAgo: 1,
    diagnosis: 'Severe sepsis secondary to UTI, on inotropes',
    allergies: 'None known',
    medications: 'Meropenem 1g TDS IV; Noradrenaline infusion titrated',
    hiv: 'Non-reactive',
    genotype: 'Hb AA',
    pregnancy: 'Not applicable',
    mentalHealth: 'ICU delirium precautions; reorientation protocol in place.',
    vitals: { hr: 118, bp: '88/54', spo2: 92, temp: 39.1 },
    nextOfKin: 'Zainab Musa (spouse)',
    lga: 'Kosofe',
    payer: 'NHIS',
    admissionSource: 'Emergency'
  },
  {
    hospitalNumber: 'HOSP-LOS-2025-091',
    fullName: 'Blessing Ojo',
    age: 36,
    gender: 'female',
    ward: 'admissions',
    bed: 'ADM-01',
    status: 'stable',
    admittedDaysAgo: 0,
    diagnosis: 'Awaiting workup - elective cholecystectomy booking',
    allergies: null,
    medications: null,
    hiv: 'Non-reactive',
    genotype: 'Hb AA',
    pregnancy: 'Not pregnant',
    mentalHealth: null,
    vitals: { hr: 74, bp: '116/74', spo2: 99, temp: 36.5 },
    nextOfKin: 'Dayo Ojo (spouse)',
    lga: 'Shomolu',
    payer: 'NHIS',
    admissionSource: 'Surgical OPD'
  },
  {
    hospitalNumber: 'HOSP-LOS-2025-092',
    fullName: 'Peter Ajayi',
    age: 65,
    gender: 'male',
    ward: 'admissions',
    bed: 'ADM-02',
    status: 'observation',
    admittedDaysAgo: 0,
    diagnosis: 'Awaiting workup - anaemia for transfusion review',
    allergies: null,
    medications: 'Ferrous sulphate 200mg TDS PO pending review',
    hiv: 'Non-reactive',
    genotype: 'Hb AS',
    pregnancy: 'Not applicable',
    mentalHealth: null,
    vitals: { hr: 88, bp: '128/80', spo2: 96, temp: 36.7 },
    nextOfKin: 'Kola Ajayi (son)',
    lga: 'Alimosho',
    payer: 'Out-of-pocket',
    admissionSource: 'Medical OPD'
  }
];

/**
 * Every sensitive plaintext present in the demo seed, exported so the
 * redaction (AT-116) and ledger-hygiene (AT-315) tests can grep for exactly
 * the values an attacker would look for. If this list and the seed drift
 * apart, those tests fail — which is the point.
 */
export function demoSensitivePlaintexts(): string[] {
  const values = new Set<string>();
  for (const patient of DEMO_PATIENTS) {
    values.add(patient.hiv);
    values.add(patient.genotype);
    if (patient.pregnancy !== null) {
      values.add(patient.pregnancy);
    }
    if (patient.mentalHealth !== null) {
      values.add(patient.mentalHealth);
    }
  }
  return [...values];
}

/** Clerk RC-1029's legitimate intake queue. Deliberately excludes HOSP-LOS-2025-082. */
const CLERK_QUEUE_NUMBERS = ['HOSP-LOS-2025-081', 'HOSP-LOS-2025-091', 'HOSP-LOS-2025-092'];

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function hashSecret(
  value: string,
  strength: 'standard' | 'fast'
): Promise<string> {
  if (strength === 'fast') {
    return argon2.hash(value, {
      type: argon2.argon2id,
      memoryCost: 8192,
      timeCost: 2,
      parallelism: 1
    });
  }
  return argon2.hash(value, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4
  });
}

function defaultMigrationsDir(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');
}

export async function seedDatabase(
  db: GridVaultDatabase,
  profile: SeedProfile,
  options: SeedOptions
): Promise<SeedResult> {
  const timeZone = options.timeZone ?? TIME_ZONE;
  const at = (date: Date): string => formatIsoWithOffset(date, timeZone);
  const baseNow = options.clock !== undefined ? options.clock.now() : (options.now ?? systemClock.now());
  const hashStrength = options.hashStrength ?? 'standard';

  migrate(db, { migrationsDir: options.migrationsDir ?? defaultMigrationsDir(), timeZone });

  const users = usersRepository(db);
  if (users.count() > 0) {
    throw new Error('seedDatabase refuses to seed a non-empty database: wipe it first (demo:reset)');
  }

  if (profile === 'empty') {
    return { profile, staff: 0, patients: 0, vitals: 0 };
  }

  const crypto = new FieldCrypto(options.masterKey);
  const patients = patientsRepository(db);
  const logistics = patientLogisticsRepository(db);
  const care = careAssignmentsRepository(db);
  const queue = admissionsQueueRepository(db);
  const clinical = clinicalDataRepository(db);
  const vitals = vitalsRepository(db);
  const notes = clinicalNotesRepository(db);

  // Staff -----------------------------------------------------------------
  const userIds = new Map<string, string>();
  for (const staff of DEMO_STAFF) {
    const id = uuidv7();
    userIds.set(staff.staffId, id);
    const pin = DEMO_PINS[staff.staffId];
    if (pin === undefined) {
      throw new Error(`Missing demo PIN for ${staff.staffId}`);
    }
    const stamp = at(baseNow);
    users.insert({
      id,
      staff_id: staff.staffId,
      full_name: staff.fullName,
      role: staff.role,
      assigned_ward: staff.ward,
      assigned_shift: staff.shift,
      password_hash: await hashSecret(demoPasswordFor(staff.staffId), hashStrength),
      pin_hash: await hashSecret(pin, hashStrength),
      account_status: 'active',
      expires_at: null,
      failed_attempts: 0,
      locked_until: null,
      created_at: stamp,
      updated_at: stamp
    });
  }

  const clerkUserId = userIds.get('RC-1029') as string;
  const adminUserId = userIds.get('AD-0012') as string;
  const doctorUserId = userIds.get('GV-9042') as string;
  const nurseUserId = userIds.get('SN-7742') as string;

  const specs: SeedPatientSpec[] =
    profile === 'demo' ? DEMO_PATIENTS : buildLoadPatients(500);
  const rng = mulberry32(profile === 'demo' ? 20260913 : 424242);

  const insertAll = db.transaction(() => {
    let vitalsCount = 0;
    for (const spec of specs) {
      const patientId = uuidv7();
      const admittedAt = new Date(baseNow.getTime() - spec.admittedDaysAgo * 86400000);
      const stamp = at(admittedAt);
      patients.insert({
        id: patientId,
        hospital_number: spec.hospitalNumber,
        full_name: spec.fullName,
        age: spec.age,
        gender: spec.gender,
        ward: spec.ward,
        bed_number: spec.bed,
        status: spec.status,
        admission_date: stamp,
        admitted_by: clerkUserId,
        version: 1,
        created_at: stamp,
        updated_at: stamp
      });
      logistics.insert({
        patient_id: patientId,
        next_of_kin: spec.nextOfKin,
        contact_phone: `+234 800 000 ${spec.hospitalNumber.slice(-4)}`,
        address_lga: `${spec.lga} LGA, Lagos State`,
        payer: spec.payer,
        admission_source: spec.admissionSource,
        updated_at: stamp
      });
      clinical.insert({
        patient_id: patientId,
        primary_diagnosis: spec.diagnosis,
        allergies: spec.allergies,
        medications_summary: spec.medications,
        hiv_status_enc: crypto.encryptField(patientId, 'hiv_status', spec.hiv, 1),
        genotype_enc: crypto.encryptField(patientId, 'genotype', spec.genotype, 1),
        pregnancy_status_enc:
          spec.pregnancy === null ? null : crypto.encryptField(patientId, 'pregnancy_status', spec.pregnancy, 1),
        mental_health_notes_enc:
          spec.mentalHealth === null
            ? null
            : crypto.encryptField(patientId, 'mental_health_notes', spec.mentalHealth, 1),
        key_version: 1,
        version: 1,
        updated_at: stamp
      });

      // Care relations: ward clinicians own their wards; the clerk owns intake.
      const attending = spec.ward === 'icu' ? doctorUserId : spec.ward === 'ward_a' ? nurseUserId : doctorUserId;
      care.insert({
        id: uuidv7(),
        patient_id: patientId,
        user_id: attending,
        relationship: spec.ward === 'icu' ? 'attending' : 'nurse_of_record',
        active_from: stamp,
        active_to: null,
        assigned_by: adminUserId,
        created_at: stamp
      });
      if (CLERK_QUEUE_NUMBERS.includes(spec.hospitalNumber)) {
        care.insert({
          id: uuidv7(),
          patient_id: patientId,
          user_id: clerkUserId,
          relationship: 'intake_clerk',
          active_from: stamp,
          active_to: null,
          assigned_by: adminUserId,
          created_at: stamp
        });
        queue.insert({
          id: uuidv7(),
          patient_id: patientId,
          clerk_id: clerkUserId,
          opened_at: stamp,
          closed_at: null
        });
      }

      // Baseline vitals (the PRD values for the named four) + history.
      const recorder = spec.ward === 'ward_a' ? 'SN-7742' : 'GV-9042';
      const historyCount = profile === 'demo' ? 16 : 100;
      for (let i = historyCount; i >= 0; i--) {
        const current = i === 0;
        const recordedAt = current
          ? new Date(baseNow.getTime() - 30 * 60000)
          : new Date(baseNow.getTime() - i * 9 * 3600000 - Math.floor(rng() * 3600000));
        const jitter = (range: number): number => Math.floor((rng() - 0.5) * 2 * range);
        vitals.insert({
          id: uuidv7(),
          patient_id: patientId,
          heart_rate: current ? spec.vitals.hr : clamp(spec.vitals.hr + jitter(6), 35, 160),
          blood_pressure: current ? spec.vitals.bp : nudgeBp(spec.vitals.bp, jitter(6), jitter(4)),
          spo2: current ? spec.vitals.spo2 : clamp(spec.vitals.spo2 + jitter(2), 85, 100),
          temperature: current ? spec.vitals.temp : round1(spec.vitals.temp + (rng() - 0.5) * 0.8),
          respiratory_rate: 16 + Math.floor(rng() * 10),
          pain_score: Math.floor(rng() * 5),
          recorded_by: recorder,
          recorded_at: at(recordedAt),
          ingested_at: at(recordedAt),
          is_offline_sync: 0,
          source: 'live',
          device_id: null,
          device_seq: null,
          client_mutation_id: uuidv7(),
          clock_skew_flag: 0
        });
        vitalsCount += 1;
      }

      if (profile === 'demo') {
        notes.insert({
          id: uuidv7(),
          patient_id: patientId,
          author_staff_id: recorder,
          note_type: 'medical',
          body: `Admitted via ${spec.admissionSource}. Working diagnosis: ${spec.diagnosis}.`,
          written_at: stamp,
          ingested_at: stamp,
          source: 'live',
          client_mutation_id: uuidv7()
        });
      }
    }
    return vitalsCount;
  });

  const vitalsTotal = insertAll();

  if (profile === 'demo') {
    seedDemoMeds(db, baseNow, at);
  }

  return { profile, staff: DEMO_STAFF.length, patients: specs.length, vitals: vitalsTotal };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function nudgeBp(bp: string, sys: number, dia: number): string {
  const parts = bp.split('/');
  const systolic = clamp(Number(parts[0]) + sys, 70, 200);
  const diastolic = clamp(Number(parts[1]) + dia, 40, 130);
  return `${systolic}/${diastolic}`;
}

function seedDemoMeds(
  db: GridVaultDatabase,
  baseNow: Date,
  at: (date: Date) => string
): void {
  const patients = patientsRepository(db);
  const mar = marEntriesRepository(db);
  const byNumber = (hospitalNumber: string): string => {
    const row = patients.findByHospitalNumber(hospitalNumber);
    if (row === undefined) {
      throw new Error(`Seed patient missing: ${hospitalNumber}`);
    }
    return row.id;
  };
  const stamp = at(baseNow);
  const entries = [
    {
      patient: 'HOSP-LOS-2025-082',
      medication: 'Methyldopa',
      dose: '250mg',
      route: 'PO',
      by: 'SN-7742',
      status: 'given' as const
    },
    {
      patient: 'HOSP-LOS-2025-084',
      medication: 'Ceftriaxone',
      dose: '2g',
      route: 'IV',
      by: 'GV-9042',
      status: 'given' as const
    },
    {
      patient: 'HOSP-LOS-2025-081',
      medication: 'Paracetamol',
      dose: '1g',
      route: 'PO',
      by: 'SN-7742',
      status: 'scheduled' as const
    }
  ];
  const insertMeds = db.transaction(() => {
    for (const entry of entries) {
      mar.insert({
        id: uuidv7(),
        patient_id: byNumber(entry.patient),
        medication: entry.medication,
        dose: entry.dose,
        route: entry.route,
        scheduled_at: stamp,
        administered_at: entry.status === 'given' ? stamp : null,
        administered_by: entry.status === 'given' ? entry.by : null,
        witnessed_by: null,
        status: entry.status,
        source: 'live',
        client_mutation_id: uuidv7()
      });
    }
  });
  insertMeds();
}

const LOAD_FIRST = [
  'Adaeze', 'Blessing', 'Chiamaka', 'Dayo', 'Emeka', 'Fatima', 'Grace', 'Halima',
  'Ibrahim', 'Kabiru', 'Kola', 'Ngozi', 'Obi', 'Peter', 'Seun', 'Tolu', 'Tunde', 'Yusuf', 'Zainab', 'Aisha'
];
const LOAD_LAST = [
  'Nnamdi', 'Okafor', 'Adeyemi', 'Adeleke', 'Bakare', 'Abdullahi', 'Ezeani', 'Sule',
  'Nwosu', 'Musa', 'Ojo', 'Ajayi', 'Danjuma', 'Balogun', 'Okonkwo', 'Eze', 'Ojo', 'Musa', 'Bello', 'Garba'
];
const LOAD_WARDS: Array<{ ward: string; bed: string }> = [
  { ward: 'ward_a', bed: 'A' },
  { ward: 'ward_b', bed: 'B' },
  { ward: 'icu', bed: 'ICU' },
  { ward: 'maternity', bed: 'M' },
  { ward: 'emergency', bed: 'E' },
  { ward: 'admissions', bed: 'ADM' }
];

/** 500 synthetic patients for load testing (NFR-1/NFR-3 groundwork). Deterministic. */
function buildLoadPatients(count: number): SeedPatientSpec[] {
  const rng = mulberry32(7717);
  const specs: SeedPatientSpec[] = [];
  for (let i = 0; i < count; i++) {
    const first = LOAD_FIRST[Math.floor(rng() * LOAD_FIRST.length)] as string;
    const last = LOAD_LAST[Math.floor(rng() * LOAD_LAST.length)] as string;
    const slot = LOAD_WARDS[i % LOAD_WARDS.length] as { ward: string; bed: string };
    const female = rng() > 0.5;
    specs.push({
      hospitalNumber: `HOSP-LOS-2025-${String(100 + i).padStart(3, '0')}`,
      fullName: `${first} ${last}`,
      age: 18 + Math.floor(rng() * 70),
      gender: female ? 'female' : 'male',
      ward: slot.ward,
      bed: `${slot.bed}-${String(Math.floor(i / LOAD_WARDS.length)).padStart(2, '0')}`,
      status: rng() > 0.85 ? 'observation' : 'stable',
      admittedDaysAgo: Math.floor(rng() * 14),
      diagnosis: 'Load-test synthetic admission',
      allergies: null,
      medications: null,
      hiv: 'Non-reactive',
      genotype: rng() > 0.8 ? 'Hb AS' : 'Hb AA',
      pregnancy: female ? 'Not pregnant' : 'Not applicable',
      mentalHealth: null,
      vitals: {
        hr: 70 + Math.floor(rng() * 30),
        bp: `${110 + Math.floor(rng() * 30)}/${70 + Math.floor(rng() * 20)}`,
        spo2: 95 + Math.floor(rng() * 5),
        temp: round1(36.4 + rng() * 1.2)
      },
      nextOfKin: `${LOAD_FIRST[Math.floor(rng() * LOAD_FIRST.length)]} ${last} (relative)`,
      lga: 'Ikeja',
      payer: rng() > 0.5 ? 'NHIS' : 'Out-of-pocket',
      admissionSource: 'Medical OPD'
    });
  }
  return specs;
}
