// GridVault field groups (PRD 6.2, 6.3).
//
// Seven groups. Five carry patient data and are evaluated per request;
// AUDIT and ADMIN are system groups evaluated at their own endpoints.
// WRITE_MATRIX answers step 11 of the decision function for direct writes.
// Notes appends are a distinct action: nurses may append notes but not edit
// clinical fields ("R + append note" in the matrix).

import type { UserRole } from '../db/repositories/users.js';

export const PATIENT_FIELD_GROUPS = [
  'DEMOGRAPHICS',
  'LOGISTICS',
  'VITALS',
  'CLINICAL',
  'SENSITIVE'
] as const;

export type FieldGroup = (typeof PATIENT_FIELD_GROUPS)[number] | 'AUDIT' | 'ADMIN';

export type PatientGroup = (typeof PATIENT_FIELD_GROUPS)[number];

/** Field names per group, used by the serializer and the PHI grep tests. */
export const FIELD_GROUP_MEMBERS: Record<(typeof PATIENT_FIELD_GROUPS)[number], string[]> = {
  DEMOGRAPHICS: [
    'full_name',
    'hospital_number',
    'age',
    'gender',
    'ward',
    'bed_number',
    'admission_date',
    'status'
  ],
  LOGISTICS: ['next_of_kin', 'contact_phone', 'address_lga', 'payer', 'admission_source'],
  VITALS: ['heart_rate', 'blood_pressure', 'spo2', 'temperature', 'respiratory_rate', 'pain_score'],
  CLINICAL: ['primary_diagnosis', 'clinical_notes', 'allergies', 'medications_summary', 'mar_entries'],
  SENSITIVE: ['hiv_status', 'genotype', 'pregnancy_status', 'mental_health_notes']
};

/** Sensitive-group plaintext column mapping for the encrypted store. */
export const SENSITIVE_COLUMNS = [
  'hiv_status',
  'genotype',
  'pregnancy_status',
  'mental_health_notes'
] as const;

/** Direct-write permission per role and patient-data group (PRD 6.3). */
export const WRITE_MATRIX: Record<UserRole, Record<(typeof PATIENT_FIELD_GROUPS)[number], boolean>> = {
  doctor: { DEMOGRAPHICS: true, LOGISTICS: false, VITALS: true, CLINICAL: true, SENSITIVE: true },
  nurse: { DEMOGRAPHICS: false, LOGISTICS: false, VITALS: true, CLINICAL: false, SENSITIVE: false },
  clerk: { DEMOGRAPHICS: true, LOGISTICS: true, VITALS: false, CLINICAL: false, SENSITIVE: false },
  admin: { DEMOGRAPHICS: false, LOGISTICS: false, VITALS: false, CLINICAL: false, SENSITIVE: false },
  cmo: { DEMOGRAPHICS: false, LOGISTICS: false, VITALS: false, CLINICAL: false, SENSITIVE: false }
};

/** Roles allowed to append notes (matrix "R + append note"). */
export const NOTE_APPEND_ROLES: ReadonlySet<UserRole> = new Set(['doctor', 'nurse']);

/** Groups a clerk may never read or write, even in-queue (PRD 6.1 step 4). */
export const CLERK_FORBIDDEN_GROUPS: ReadonlySet<string> = new Set(['VITALS', 'CLINICAL', 'SENSITIVE']);

/** Groups denied to admin/cmo on patient data (PRD 6.1 step 6 + matrix "—"). */
export const ADMIN_FORBIDDEN_GROUPS: ReadonlySet<string> = new Set([
  'VITALS',
  'LOGISTICS',
  'CLINICAL',
  'SENSITIVE'
]);
