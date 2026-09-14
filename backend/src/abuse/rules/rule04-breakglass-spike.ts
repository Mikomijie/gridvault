// RULE-ABUSE-04 — break-glass frequency spike (PRD 9.2).
//
// Predicate: >= N grants by one staff member within M minutes (default 2 in
// 60), or grants across >= 2 distinct wards. Severity CRITICAL. Action: the
// grant still succeeds (care first) with an escalated CMO dispatch and an
// urgent review tag. The grant writer lives in override/service.ts; this
// module owns the counting predicate.

export const RULE_ID = 'RULE-ABUSE-04' as const;

export function isFrequencySpike(grantsInWindow: number, thresholdCount: number): boolean {
  return grantsInWindow >= thresholdCount - 1 && grantsInWindow >= 1;
}
