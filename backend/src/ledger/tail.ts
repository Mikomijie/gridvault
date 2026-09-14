// GridVault ledger tail reads for the SSE inspector stream (PRD 12.5).
//
// Route handlers must not touch SQL or repositories directly (AGENTS.md §5),
// so the audit stream reads through these functions. They return ledger rows
// only; privilege is checked by the caller via the ledger-access decision
// before the stream opens.

import type { GridVaultDatabase } from '../db/connection.js';
import { auditLogsRepository, type AuditLogRow } from '../db/repositories/ledger.js';

export function ledgerHeadIndex(db: GridVaultDatabase): number | null {
  return auditLogsRepository(db).maxIndex();
}

export function recentLedgerEntries(db: GridVaultDatabase, limit: number): AuditLogRow[] {
  return auditLogsRepository(db).listRecent(limit);
}

export function ledgerEntriesSince(
  db: GridVaultDatabase,
  logIndex: number,
  limit: number
): AuditLogRow[] {
  return auditLogsRepository(db).listSince(logIndex, limit);
}
