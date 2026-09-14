// RULE-ABUSE-07 — sensitive-field sweep (PRD 9.2).
//
// Predicate: >= N distinct patients' SENSITIVE group read in M minutes
// (default 5 in 10) without a corresponding care assignment. Severity
// CRITICAL. Action: block further sensitive reads for 15 min plus an alert.

export const RULE_ID = 'RULE-ABUSE-07' as const;

export function isSensitiveSweep(
  distinctSensitivePatients: number,
  threshold: number
): boolean {
  return distinctSensitivePatients >= threshold;
}
