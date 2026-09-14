// RULE-ABUSE-06 — bulk enumeration (PRD 9.2).
//
// Predicate: > N distinct patient_id reads by one subject in 5 min (default
// 20), or > M in 60 min (default 60). Severity WARNING, CRITICAL at 2x.
// Action: throttle subsequent reads to 1 rps plus an alert. Counting lives in
// the engine (ledger query); the threshold boundary lives here.

export const RULE_ID = 'RULE-ABUSE-06' as const;

export function bulkVerdict(
  distinct5: number,
  distinct60: number,
  thresholds: { shortWindow: number; longWindow: number; criticalMultiplier: number }
): 'NONE' | 'WARNING' | 'CRITICAL' {
  if (
    distinct5 >= thresholds.shortWindow * thresholds.criticalMultiplier ||
    distinct60 >= thresholds.longWindow * thresholds.criticalMultiplier
  ) {
    return 'CRITICAL';
  }
  if (distinct5 > thresholds.shortWindow || distinct60 > thresholds.longWindow) {
    return 'WARNING';
  }
  return 'NONE';
}
