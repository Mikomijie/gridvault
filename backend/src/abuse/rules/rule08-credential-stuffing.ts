// RULE-ABUSE-08 — credential stuffing (PRD 9.2).
//
// Predicate: >= N failed logins for one staff_id or IP in M minutes
// (default 5 in 10). Severity WARNING. Action: 15-minute lockout plus an
// alert. The counter lives in auth/service.ts; this module owns the lockout
// boundary.

export const RULE_ID = 'RULE-ABUSE-08' as const;

export function shouldLockout(failuresInWindow: number, threshold: number): boolean {
  return failuresInWindow >= threshold;
}
