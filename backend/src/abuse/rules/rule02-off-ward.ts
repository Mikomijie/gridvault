// RULE-ABUSE-02 — off-ward snooping (PRD 9.2).
//
// Predicate: resource.ward != subject.assigned_ward AND no active grant.
// Severity WARNING, escalating to CRITICAL on the Nth attempt inside the
// window (default 3rd in 15 min). Action: 403 with a break-glass affordance
// plus an alert. The count query lives in the engine (it needs the DB); the
// escalation boundary lives here so it is unit-testable.

export const RULE_ID = 'RULE-ABUSE-02' as const;

export function escalationSeverity(
  priorAttemptsInWindow: number,
  escalationCount: number
): 'WARNING' | 'CRITICAL' {
  return priorAttemptsInWindow + 1 >= escalationCount ? 'CRITICAL' : 'WARNING';
}
