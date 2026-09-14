// Ledger repositories: audit_logs and chain_anchors.
//
// audit_logs is append-only by database trigger AND by API design: this
// module exposes insert (raw row write, used by the P2 ledger append path
// and by nothing else) and reads. There is deliberately no update or delete
// method to call. Hand-written SQL, always parameterised.

import type { GridVaultDatabase } from '../connection.js';

export interface AuditLogRow {
  log_index: number;
  timestamp: string;
  staff_id: string;
  staff_role: string;
  ward: string;
  patient_id: string;
  action: string;
  details: string;
  session_id: string | null;
  terminal_id: string | null;
  source_ip: string | null;
  prev_hash: string;
  current_hash: string;
}

export type AuditLogInsert = Omit<AuditLogRow, 'log_index'>;

export type AnchorStatus = 'PENDING' | 'ACKNOWLEDGED' | 'FAILED';

export interface ChainAnchorRow {
  receipt_id: string;
  facility_id: string;
  chain_head_index: number;
  chain_head_hash: string;
  entry_count: number;
  anchored_at: string;
  node_signature: string;
  witness_ack: string | null;
  witness_acked_at: string | null;
  status: AnchorStatus;
}

export function auditLogsRepository(db: GridVaultDatabase) {
  return {
    insert(row: AuditLogInsert): number {
      const result = db
        .prepare(
          'INSERT INTO audit_logs (timestamp, staff_id, staff_role, ward, patient_id, action, ' +
            'details, session_id, terminal_id, source_ip, prev_hash, current_hash) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          row.timestamp,
          row.staff_id,
          row.staff_role,
          row.ward,
          row.patient_id,
          row.action,
          row.details,
          row.session_id,
          row.terminal_id,
          row.source_ip,
          row.prev_hash,
          row.current_hash
        );
      return Number(result.lastInsertRowid);
    },
    getByIndex(logIndex: number): AuditLogRow | undefined {
      return db.prepare('SELECT * FROM audit_logs WHERE log_index = ?').get(logIndex) as
        | AuditLogRow
        | undefined;
    },
    listOrdered(limit: number, offset = 0): AuditLogRow[] {
      return db
        .prepare('SELECT * FROM audit_logs ORDER BY log_index ASC LIMIT ? OFFSET ?')
        .all(limit, offset) as AuditLogRow[];
    },
    count(): number {
      const row = db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get() as { n: number };
      return row.n;
    },
    maxIndex(): number | null {
      const row = db.prepare('SELECT MAX(log_index) AS m FROM audit_logs').get() as {
        m: number | null;
      };
      return row.m;
    },
    listRecent(limit: number): AuditLogRow[] {
      return db
        .prepare('SELECT * FROM audit_logs ORDER BY log_index DESC LIMIT ?')
        .all(limit) as AuditLogRow[];
    },
    listSince(logIndex: number, limit: number): AuditLogRow[] {
      return db
        .prepare('SELECT * FROM audit_logs WHERE log_index > ? ORDER BY log_index ASC LIMIT ?')
        .all(logIndex, limit) as AuditLogRow[];
    }
  };
}

export function chainAnchorsRepository(db: GridVaultDatabase) {
  return {
    insert(row: ChainAnchorRow): void {
      db.prepare(
        'INSERT INTO chain_anchors (receipt_id, facility_id, chain_head_index, chain_head_hash, entry_count, ' +
          'anchored_at, node_signature, witness_ack, witness_acked_at, status) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        row.receipt_id,
        row.facility_id,
        row.chain_head_index,
        row.chain_head_hash,
        row.entry_count,
        row.anchored_at,
        row.node_signature,
        row.witness_ack,
        row.witness_acked_at,
        row.status
      );
    },
    listByStatus(status: AnchorStatus): ChainAnchorRow[] {
      return db
        .prepare('SELECT * FROM chain_anchors WHERE status = ? ORDER BY chain_head_index ASC')
        .all(status) as ChainAnchorRow[];
    },
    /**
     * The only mutation allowed on an anchor row: PENDING -> ACKNOWLEDGED
     * (or FAILED on a rejected submission). The receipt fields themselves
     * are never updated — a settled receipt is history, not state.
     */
    settle(
      receiptId: string,
      patch: { status: AnchorStatus; witness_ack: string | null; witness_acked_at: string | null }
    ): void {
      db.prepare(
        'UPDATE chain_anchors SET status = ?, witness_ack = ?, witness_acked_at = ? WHERE receipt_id = ?'
      ).run(patch.status, patch.witness_ack, patch.witness_acked_at, receiptId);
    },
    latest(): ChainAnchorRow | undefined {
      return db
        .prepare('SELECT * FROM chain_anchors ORDER BY chain_head_index DESC LIMIT 1')
        .get() as ChainAnchorRow | undefined;
    }
  };
}
