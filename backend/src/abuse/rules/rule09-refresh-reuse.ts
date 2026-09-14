// RULE-ABUSE-09 — refresh token reuse (PRD 9.2).
//
// Predicate: a rotated refresh token is presented twice. Severity CRITICAL.
// Action: kill the whole session family, force re-login, raise an alert.
// Detection lives in auth/service.ts (revoked_reason == 'rotated'); this
// module names the rule so the mapping is testable and greppable.

export const RULE_ID = 'RULE-ABUSE-09' as const;

export function isReuseOfRotatedToken(revokedReason: string | null): boolean {
  return revokedReason === 'rotated';
}
