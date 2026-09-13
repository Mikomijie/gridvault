// Sync repository: sync_mutations idempotency ledger.
// Hand-written SQL, always parameterised.

import type { GridVaultDatabase } from '../connection.js';

export interface SyncMutationRow {
  client_mutation_id: string;
  device_id: string;
  device_seq: number;
  type: string;
  patient_id: string;
  applied_at: string;
  result_json: string;
  audit_log_index: number | null;
}

export function syncMutationsRepository(db: GridVaultDatabase) {
  return {
    insert(row: SyncMutationRow): void {
      db.prepare(
        'INSERT INTO sync_mutations (client_mutation_id, device_id, device_seq, type, patient_id, ' +
          'applied_at, result_json, audit_log_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        row.client_mutation_id,
        row.device_id,
        row.device_seq,
        row.type,
        row.patient_id,
        row.applied_at,
        row.result_json,
        row.audit_log_index
      );
    },
    findByClientMutationId(clientMutationId: string): SyncMutationRow | undefined {
      return db
        .prepare('SELECT * FROM sync_mutations WHERE client_mutation_id = ?')
        .get(clientMutationId) as SyncMutationRow | undefined;
    },
    maxDeviceSeq(deviceId: string): number | null {
      const row = db
        .prepare('SELECT MAX(device_seq) AS m FROM sync_mutations WHERE device_id = ?')
        .get(deviceId) as { m: number | null };
      return row.m;
    }
  };
}
