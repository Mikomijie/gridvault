// RULE-ABUSE-05 — administrator clinical reach (PRD 9.2).
//
// Predicate: role in {'admin','cmo'} AND requested group in CLINICAL ∪
// SENSITIVE. Severity CRITICAL. Action: block, and route the alert to the
// CMO and the facility data-protection officer — never to the acting admin,
// who must not triage their own reach.

export const RULE_ID = 'RULE-ABUSE-05' as const;

export function alertRecipients(actorStaffId: string, cmoStaffId: string): string[] {
  const recipients = [cmoStaffId, 'role:dpo'].filter((r) => r !== actorStaffId);
  return [...new Set(recipients)];
}
