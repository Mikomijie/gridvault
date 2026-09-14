// GridVault abuse obligation engine (PRD 9.1, 9.2).
//
// Rules evaluate synchronously, inside the request, before the response is
// serialized, and can block. The policy engine emits obligations
// (RAISE_ABUSE with a rule id); this module executes them: one alert row +
// one ABUSE_ALERT_RAISED ledger entry, carrying the policy decision_id so
// the alert is provably the product of a real decision (AT-401), never a
// fabricated row.
//
// Threshold state machines (RULE-ABUSE-02 escalation, RULE-ABUSE-06 bulk
// detection) and the SSE fan-out arrive in P6; the alert shape and the
// synchronous execution path are fixed here so P4/P5 callers are already
// correct.

import type { GridVaultDatabase } from '../db/connection.js';
import type { Clock } from '../clock.js';
import { systemClock } from '../clock.js';
import { raiseAbuseAlert } from './alerts.js';
import type { Decision } from '../policy/decide.js';
import type { AlertSeverity } from '../db/repositories/security.js';

export interface ObligationContext {
  staff_id: string;
  staff_role: string;
  ward: string;
  patient_id: string;
  decision_id: string;
  session_id?: string | null;
  terminal_id?: string | null;
  source_ip?: string | null;
}

/** Execute the RAISE_ABUSE obligations of a decision, synchronously. */
export function executeDecisionObligations(
  db: GridVaultDatabase,
  decision: Decision,
  context: ObligationContext,
  options: { clock?: Clock; timeZone?: string } = {}
): string[] {
  const alertIds: string[] = [];
  for (const obligation of decision.obligations) {
    if (obligation.kind !== 'RAISE_ABUSE' || obligation.rule === undefined) {
      continue;
    }
    const raised = raiseAbuseAlert(
      db,
      {
        staff_id: context.staff_id,
        patient_id: context.patient_id,
        rule_triggered: obligation.rule,
        severity: (obligation.severity ?? 'WARNING') as AlertSeverity,
        facts: { decision_id: decision.decision_id, reason: decision.reason_code },
        decision_id: decision.decision_id,
        session_id: context.session_id ?? null,
        terminal_id: context.terminal_id ?? null,
        source_ip: context.source_ip ?? null,
        staff_role: context.staff_role,
        ward: context.ward
      },
      { clock: options.clock ?? systemClock, timeZone: options.timeZone ?? 'Africa/Lagos' }
    );
    alertIds.push(raised.alert_id);
  }
  return alertIds;
}
