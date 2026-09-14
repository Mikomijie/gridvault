// GridVault notifier outbox (PRD 7.5).
//
// Dispatch is never on the care path: grants insert PENDING rows in the
// same transaction as the grant, and delivery is a separate worker step
// (dispatchPending) that can fail without touching the grant. A throwing
// driver leaves the row PENDING with attempts/last_error recorded — the
// grant still succeeds (AT-208). Rows older than 15 minutes without
// delivery surface as DISPATCH_DEGRADED in the security console (P6).

import { v7 as uuidv7 } from 'uuid';
import type { GridVaultDatabase } from '../db/connection.js';
import { formatIsoWithOffset, systemClock, type Clock } from '../clock.js';
import { notificationOutboxRepository } from '../db/repositories/security.js';

export interface OutboxMessage {
  channel: string;
  recipient: string;
  subject: string;
  body: string;
  priority: 'HIGH' | 'NORMAL' | 'LOW';
  related_type?: string | null;
  related_id?: string | null;
}

/** Pluggable delivery driver. Throwing signals a failed attempt, never a lost message. */
export interface NotifyDriver {
  readonly name: string;
  dispatch(message: OutboxMessage): Promise<void>;
}

/** Default driver: durable local delivery marker (ops wires SMS/SMTP here). */
export class LocalLogDriver implements NotifyDriver {
  readonly name = 'local-log';
  async dispatch(_message: OutboxMessage): Promise<void> {
    return Promise.resolve();
  }
}

export interface DispatchResult {
  attempted: number;
  dispatched: number;
  failed: number;
}

export function queueOutbox(
  db: GridVaultDatabase,
  message: OutboxMessage,
  options: { clock?: Clock; timeZone?: string } = {}
): string {
  const clock = options.clock ?? systemClock;
  const id = uuidv7();
  notificationOutboxRepository(db).insert({
    id,
    channel: message.channel,
    recipient: message.recipient,
    subject: message.subject,
    body: message.body,
    priority: message.priority,
    related_type: message.related_type ?? null,
    related_id: message.related_id ?? null,
    status: 'PENDING',
    attempts: 0,
    last_error: null,
    created_at: formatIsoWithOffset(clock.now(), options.timeZone ?? 'Africa/Lagos'),
    dispatched_at: null,
    delivered_at: null
  });
  return id;
}

/**
 * Attempt delivery of every PENDING row. Never throws: a driver failure is
 * recorded on the row so the message survives restarts and power cuts.
 */
export async function dispatchPending(
  db: GridVaultDatabase,
  driver: NotifyDriver,
  options: { clock?: Clock; timeZone?: string } = {}
): Promise<DispatchResult> {
  const clock = options.clock ?? systemClock;
  const timeZone = options.timeZone ?? 'Africa/Lagos';
  const pending = notificationOutboxRepository(db).listPending();
  const result: DispatchResult = { attempted: pending.length, dispatched: 0, failed: 0 };
  for (const row of pending) {
    const at = formatIsoWithOffset(clock.now(), timeZone);
    try {
      await driver.dispatch({
        channel: row.channel,
        recipient: row.recipient,
        subject: row.subject,
        body: row.body,
        priority: row.priority as OutboxMessage['priority'],
        related_type: row.related_type,
        related_id: row.related_id
      });
      db.prepare(
        "UPDATE notification_outbox SET status = 'DISPATCHED', attempts = attempts + 1, dispatched_at = ? WHERE id = ?"
      ).run(at, row.id);
      result.dispatched += 1;
    } catch (error) {
      db.prepare(
        'UPDATE notification_outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?'
      ).run(error instanceof Error ? error.message.slice(0, 500) : 'dispatch failed', row.id);
      result.failed += 1;
    }
  }
  return result;
}
