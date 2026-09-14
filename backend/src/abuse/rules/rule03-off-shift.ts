// RULE-ABUSE-03 — off-shift credential use (PRD 9.2).
//
// Predicate: duty_state == 'off_duty' AND no scheduled extension covers now.
// Severity WARNING. Action: deny with a break-glass affordance and queue a
// charge-nurse notification. The duty computation lives in policy/duty.ts;
// this module owns the alert recipient so routing is testable.

export const RULE_ID = 'RULE-ABUSE-03' as const;

export function chargeNurseRecipient(ward: string): string {
  return `charge_nurse:${ward}`;
}
