// GridVault structured logger (PRD 14.7).
//
// pino with automatic redaction of known PHI keys, credentials and key
// material. Log field NAMES, decision codes, ids and counts — never values.
// AT-908 greps full demo-run log output for seed PHI, passwords, tokens and
// key material and fails the build if any appear.

import pino, { type Logger } from 'pino';

/** Keys whose VALUES must never appear in logs. Nested paths included. */
export const REDACTED_KEYS = [
  'password',
  'pin',
  'access_token',
  'refresh_token',
  'refreshToken',
  'authorization',
  'cookie',
  'GRIDVAULT_MASTER_KEY',
  'JWT_SECRET',
  'NODE_SIGNING_KEY',
  'WITNESS_API_KEY',
  'masterKey',
  'full_name',
  'fullName',
  'hiv_status',
  'hivStatus',
  'genotype',
  'pregnancy_status',
  'pregnancyStatus',
  'mental_health_notes',
  'mentalHealthNotes',
  'primary_diagnosis',
  'primaryDiagnosis',
  'clinical_notes',
  'allergies',
  'medications_summary',
  'next_of_kin',
  'contact_phone',
  'address_lga',
  'body',
  'note_body'
];

export function createLogger(level: string = process.env.LOG_LEVEL ?? 'info'): Logger {
  return pino({
    level,
    redact: {
      paths: REDACTED_KEYS.flatMap((key) => [
        key,
        `*.${key}`,
        `*.*.${key}`,
        `req.body.${key}`,
        `res.${key}`,
        `details.${key}`
      ]),
      censor: '[REDACTED]'
    }
  });
}

export const logger = createLogger();
