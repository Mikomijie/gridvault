// GridVault abuse-alert writer.
//
// The P6 rule engine evaluates predicates; this module owns the alert row +
// ledger entry pair, so every raiser (login lockout, refresh reuse, policy
// obligations) produces the same shape. One alert always pairs with exactly
// one ABUSE_ALERT_RAISED ledger entry, joined to the caller's ambient
// transaction when one exists. Details carry identifiers, rule ids, counts
// and decision codes — never PHI values.

import { v7 as uuidv7 } from 'uuid';
import type { GridVaultDatabase } from '../db/connection.js';
import type { Clock } from '../clock.js';
import { formatIsoWithOffset, systemClock } from '../clock.js';
import { appendLedgerEntry } from '../ledger/append.js';
import { abuseAlertsRepository, type AlertSeverity } from '../db/repositories/security.js';
import { canonicalJson } from '../crypto/canonical-json.js';

export interface RaiseAlertInput {
  staff_id: string;
  patient_id: string;
  rule_triggered: string;
  severity: AlertSeverity;
  /** Identifiers and codes only. Never PHI values. */
  facts: Record<string, string | number | boolean | null>;
  decision_id?: string | null;
  session_id?: string | null;
  terminal_id?: string | null;
  source_ip?: string | null;
  staff_role?: string;
  ward?: string;
}

export interface RaiseAlertResult {
  alert_id: string;
  audit_log_index: number;
}

export function raiseAbuseAlert(
  db: GridVaultDatabase,
  input: RaiseAlertInput,
  options: { clock?: Clock; timeZone?: string } = {}
): RaiseAlertResult {
  const clock = options.clock ?? systemClock;
  const timeZone = options.timeZone ?? 'Africa/Lagos';
  const at = formatIsoWithOffset(clock.now(), timeZone);
  // Full UUIDv7 hex: a sliced prefix would collide for alerts raised in the
  // same millisecond (two denials in one burst must not 500 on the PK).
  const alertId = `al_${uuidv7().replace(/-/g, '')}`;

  const write = db.transaction(() => {
    const ledger = appendLedgerEntry(
      db,
      {
        staff_id: input.staff_id,
        staff_role: input.staff_role ?? 'unknown',
        ward: input.ward ?? 'unknown',
        patient_id: input.patient_id,
        action: 'ABUSE_ALERT_RAISED',
        details: {
          alert_id: alertId,
          rule: input.rule_triggered,
          severity: input.severity,
          decision_id: input.decision_id ?? null,
          facts: input.facts
        },
        session_id: input.session_id ?? null,
        terminal_id: input.terminal_id ?? null,
        source_ip: input.source_ip ?? null,
        timestamp: at
      },
      { clock, timeZone }
    );
    abuseAlertsRepository(db).insert({
      id: alertId,
      timestamp: at,
      staff_id: input.staff_id,
      patient_id: input.patient_id,
      rule_triggered: input.rule_triggered,
      severity: input.severity,
      details: canonicalJson({ severity: input.severity, ...input.facts }),
      decision_id: input.decision_id ?? null,
      audit_log_index: ledger.log_index,
      terminal_id: input.terminal_id ?? null,
      source_ip: input.source_ip ?? null,
      status: 'FLAGGED',
      resolution: null,
      resolved_by: null,
      resolved_at: null,
      resolution_notes: null
    });
    return ledger.log_index;
  });
  const auditLogIndex = write();
  return { alert_id: alertId, audit_log_index: auditLogIndex };
}
