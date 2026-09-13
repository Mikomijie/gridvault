// Security repositories: abuse_alerts and notification_outbox.
// Hand-written SQL, always parameterised.

import type { GridVaultDatabase } from '../connection.js';

export type AlertSeverity = 'CRITICAL' | 'WARNING' | 'INFO';
export type AlertStatus = 'FLAGGED' | 'INVESTIGATING' | 'RESOLVED';

export interface AbuseAlertRow {
  id: string;
  timestamp: string;
  staff_id: string;
  patient_id: string;
  rule_triggered: string;
  severity: AlertSeverity;
  details: string;
  decision_id: string | null;
  audit_log_index: number | null;
  terminal_id: string | null;
  source_ip: string | null;
  status: AlertStatus;
  resolution: 'justified' | 'confirmed_abuse' | 'false_positive' | null;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
}

export type OutboxStatus = 'PENDING' | 'DISPATCHED' | 'DELIVERED' | 'FAILED';

export interface NotificationOutboxRow {
  id: string;
  channel: string;
  recipient: string;
  subject: string;
  body: string;
  priority: string;
  related_type: string | null;
  related_id: string | null;
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
  created_at: string;
  dispatched_at: string | null;
  delivered_at: string | null;
}

export function abuseAlertsRepository(db: GridVaultDatabase) {
  return {
    insert(row: AbuseAlertRow): void {
      db.prepare(
        'INSERT INTO abuse_alerts (id, timestamp, staff_id, patient_id, rule_triggered, severity, ' +
          'details, decision_id, audit_log_index, terminal_id, source_ip, status, resolution, ' +
          'resolved_by, resolved_at, resolution_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        row.id,
        row.timestamp,
        row.staff_id,
        row.patient_id,
        row.rule_triggered,
        row.severity,
        row.details,
        row.decision_id,
        row.audit_log_index,
        row.terminal_id,
        row.source_ip,
        row.status,
        row.resolution,
        row.resolved_by,
        row.resolved_at,
        row.resolution_notes
      );
    },
    findById(id: string): AbuseAlertRow | undefined {
      return db.prepare('SELECT * FROM abuse_alerts WHERE id = ?').get(id) as
        | AbuseAlertRow
        | undefined;
    },
    listByStatus(status: AlertStatus): AbuseAlertRow[] {
      return db
        .prepare('SELECT * FROM abuse_alerts WHERE status = ? ORDER BY timestamp DESC')
        .all(status) as AbuseAlertRow[];
    }
  };
}

export function notificationOutboxRepository(db: GridVaultDatabase) {
  return {
    insert(row: NotificationOutboxRow): void {
      db.prepare(
        'INSERT INTO notification_outbox (id, channel, recipient, subject, body, priority, ' +
          'related_type, related_id, status, attempts, last_error, created_at, dispatched_at, delivered_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        row.id,
        row.channel,
        row.recipient,
        row.subject,
        row.body,
        row.priority,
        row.related_type,
        row.related_id,
        row.status,
        row.attempts,
        row.last_error,
        row.created_at,
        row.dispatched_at,
        row.delivered_at
      );
    },
    listPending(): NotificationOutboxRow[] {
      return db
        .prepare("SELECT * FROM notification_outbox WHERE status = 'PENDING' ORDER BY created_at ASC")
        .all() as NotificationOutboxRow[];
    }
  };
}
