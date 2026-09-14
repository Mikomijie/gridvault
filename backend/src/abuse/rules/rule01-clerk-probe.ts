// RULE-ABUSE-01 — clerk clinical probe (PRD 9.2).
//
// Predicate: role == 'clerk' AND (requested group in CLINICAL ∪ SENSITIVE OR
// patient not in the clerk's open intake queue). Severity CRITICAL. Action:
// block (403 for out-of-queue, redact + alert for clinical fields) with a
// ledger entry. The policy engine owns the verdict; this module owns the
// predicate definition so the rule is testable in isolation.

import type { UserRole } from '../../db/repositories/users.js';
import type { PatientGroup } from '../../policy/field-groups.js';

export const RULE_ID = 'RULE-ABUSE-01' as const;

const CLINICAL_GROUPS: ReadonlySet<PatientGroup> = new Set(['CLINICAL', 'SENSITIVE', 'VITALS']);

export function isClerkProbe(input: {
  role: UserRole;
  inIntakeQueue: boolean;
  requested: PatientGroup[];
}): boolean {
  if (input.role !== 'clerk') {
    return false;
  }
  if (!input.inIntakeQueue) {
    return true;
  }
  return input.requested.some((group) => CLINICAL_GROUPS.has(group));
}
