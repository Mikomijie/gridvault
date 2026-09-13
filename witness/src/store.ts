// GridVault witness anchor store (PRD 8.6).
//
// The witness holds anchor receipts under separate custody from the ward
// node. It never sees patient data — receipts carry only hashes, indices,
// facility identifiers and signatures — and its store is append-only: there
// is no update or delete path, only insert with idempotent replay of the
// same receipt_id.
//
// Persistence is an append-only JSONL file (one receipt per line) replayed
// at boot. When no data path is configured the store is memory-only, which
// the boot log states explicitly so nobody mistakes it for durable custody.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface StoredAnchorReceipt {
  receipt_id: string;
  facility_id: string;
  chain_head_index: number;
  chain_head_hash: string;
  entry_count: number;
  anchored_at: string;
  node_signature: string;
  witness_ack: string;
  witnessed_at: string;
}

export class WitnessStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WitnessStoreError';
  }
}

export interface WitnessStore {
  insert(receipt: StoredAnchorReceipt): void;
  get(receiptId: string): StoredAnchorReceipt | undefined;
  list(): StoredAnchorReceipt[];
  latest(): StoredAnchorReceipt | undefined;
  readonly size: number;
}

export function createMemoryStore(initial: StoredAnchorReceipt[] = []): WitnessStore {
  const byId = new Map<string, StoredAnchorReceipt>();
  let head: StoredAnchorReceipt | undefined;
  for (const receipt of initial) {
    byId.set(receipt.receipt_id, receipt);
    if (head === undefined || receipt.chain_head_index > head.chain_head_index) {
      head = receipt;
    }
  }
  return {
    insert(receipt: StoredAnchorReceipt): void {
      byId.set(receipt.receipt_id, receipt);
      if (head === undefined || receipt.chain_head_index >= head.chain_head_index) {
        head = receipt;
      }
    },
    get(receiptId: string): StoredAnchorReceipt | undefined {
      return byId.get(receiptId);
    },
    list(): StoredAnchorReceipt[] {
      return [...byId.values()].sort((a, b) => a.chain_head_index - b.chain_head_index);
    },
    latest(): StoredAnchorReceipt | undefined {
      return head;
    },
    get size(): number {
      return byId.size;
    }
  };
}

/**
 * Open a durable store: replay the JSONL file if present, then append each
 * future insert. Replay skips blank lines and fails closed on a corrupt
 * line — a witness that cannot read its own history must not serve
 * divergence verdicts from a partial view.
 */
export function openDurableStore(dataPath: string): WitnessStore {
  mkdirSync(path.dirname(dataPath), { recursive: true });
  const initial: StoredAnchorReceipt[] = [];
  if (existsSync(dataPath)) {
    const content = readFileSync(dataPath, 'utf8');
    for (const line of content.split('\n')) {
      if (line.trim().length === 0) {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(line) as unknown;
      } catch {
        throw new WitnessStoreError(`Witness data file is corrupt: unparseable line in ${dataPath}`);
      }
      initial.push(parsed as StoredAnchorReceipt);
    }
  }
  const memory = createMemoryStore(initial);
  return {
    insert(receipt: StoredAnchorReceipt): void {
      memory.insert(receipt);
      appendFileSync(dataPath, JSON.stringify(receipt) + '\n', 'utf8');
    },
    get: (receiptId: string) => memory.get(receiptId),
    list: () => memory.list(),
    latest: () => memory.latest(),
    get size(): number {
      return memory.size;
    }
  };
}
