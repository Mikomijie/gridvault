// GridVault clinical status derivation (PRD 12.7).
//
// Recomputed on every vitals write. A triage-support heuristic for
// prototype demonstration, labelled as such in the UI — never a diagnosis,
// and never suppressing a clinician-set status (that override path records
// its author; see the records service).

import type { PatientStatus } from '../db/repositories/patients.js';

export interface VitalsReading {
  heart_rate: number;
  blood_pressure: string;
  spo2: number;
  temperature: number;
}

export function parseBloodPressure(value: string): { systolic: number; diastolic: number } | null {
  const match = /^(\d{2,3})\s*\/\s*(\d{2,3})$/.exec(value.trim());
  if (match === null) {
    return null;
  }
  return { systolic: Number(match[1]), diastolic: Number(match[2]) };
}

export function deriveStatus(reading: VitalsReading): PatientStatus {
  const bp = parseBloodPressure(reading.blood_pressure);
  const systolic = bp?.systolic;
  const diastolic = bp?.diastolic;
  if (
    reading.spo2 < 90 ||
    (systolic !== undefined && (systolic < 90 || systolic >= 180)) ||
    (diastolic !== undefined && diastolic >= 120) ||
    reading.heart_rate < 40 ||
    reading.heart_rate > 130 ||
    reading.temperature >= 39.5 ||
    reading.temperature < 35.0
  ) {
    return 'critical';
  }
  if (
    reading.spo2 < 95 ||
    (systolic !== undefined && systolic >= 140) ||
    (diastolic !== undefined && diastolic >= 90) ||
    reading.heart_rate < 50 ||
    reading.heart_rate > 110 ||
    reading.temperature >= 38.0
  ) {
    return 'observation';
  }
  return 'stable';
}
