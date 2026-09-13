// GridVault witness service (PRD 8.6): the independent anchor receiver.
//
// Separate host, separate credentials, separate custody from the ward node.
// It stores signed chain-head receipts append-only and serves them back for
// divergence comparison. It holds no patient data, no keys and no database
// credentials — a compromised witness leaks anchor hashes, not charts.
//
// Custody: every /anchors route requires `Authorization: Bearer
// <WITNESS_API_KEY>` when the key is configured. An unconfigured witness
// (local development) states so loudly at boot and in `GET /health`.

import express from 'express';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  createMemoryStore,
  openDurableStore,
  type StoredAnchorReceipt,
  type WitnessStore
} from './store.js';
import { ReceiptValidationError, validateAnchorReceipt } from './receipts.js';

export interface WitnessAppOptions {
  /** Defaults to process.env.WITNESS_API_KEY. Empty means "no custody" (development only). */
  apiKey?: string;
  /** Defaults to an in-memory store, or a durable one when WITNESS_DATA_PATH is set. */
  store?: WitnessStore;
}

function resolveApiKey(explicit: string | undefined): string {
  const key = explicit ?? process.env.WITNESS_API_KEY ?? '';
  return key.trim();
}

function bearerMatches(header: string | undefined, expected: string): boolean {
  if (header === undefined || expected.length === 0) {
    return false;
  }
  const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}

function resolveStore(explicit: WitnessStore | undefined): { store: WitnessStore; durable: boolean } {
  if (explicit !== undefined) {
    return { store: explicit, durable: false };
  }
  const dataPath = (process.env.WITNESS_DATA_PATH ?? '').trim();
  if (dataPath.length > 0) {
    return { store: openDurableStore(dataPath), durable: true };
  }
  return { store: createMemoryStore(), durable: false };
}

function newAck(): { witness_ack: string; witnessed_at: string } {
  return {
    witness_ack: `wit_${randomUUID().replace(/-/g, '')}`,
    witnessed_at: new Date().toISOString()
  };
}

export function createWitnessApp(options: WitnessAppOptions = {}): express.Express {
  const apiKey = resolveApiKey(options.apiKey);
  const { store, durable } = resolveStore(options.store);
  const custodial = apiKey.length > 0;

  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'gridvault-witness',
      custody: custodial ? 'api-key' : 'none-development-only',
      storage: durable ? 'durable' : 'memory-only',
      anchors: store.size
    });
  });

  const requireApiKey: express.RequestHandler = (req, res, next) => {
    if (!custodial) {
      next();
      return;
    }
    if (!bearerMatches(req.header('authorization'), apiKey)) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Valid witness API key required' } });
      return;
    }
    next();
  };

  app.post('/anchors', requireApiKey, (req, res) => {
    let receipt;
    try {
      receipt = validateAnchorReceipt(req.body as unknown);
    } catch (error) {
      const code = error instanceof ReceiptValidationError ? error.code : 'INVALID_RECEIPT';
      const message = error instanceof Error ? error.message : 'Invalid anchor receipt';
      res.status(400).json({ error: { code, message } });
      return;
    }

    const existing = store.get(receipt.receipt_id);
    if (existing !== undefined) {
      const sameContent =
        existing.facility_id === receipt.facility_id &&
        existing.chain_head_index === receipt.chain_head_index &&
        existing.chain_head_hash === receipt.chain_head_hash &&
        existing.entry_count === receipt.entry_count &&
        existing.anchored_at === receipt.anchored_at &&
        existing.node_signature === receipt.node_signature;
      if (!sameContent) {
        // Append-only means a receipt_id can never be rewritten.
        res
          .status(409)
          .json({ error: { code: 'DUPLICATE_RECEIPT', message: 'receipt_id already stored with different content' } });
        return;
      }
      res
        .status(200)
        .json({ receipt_id: existing.receipt_id, witness_ack: existing.witness_ack, witnessed_at: existing.witnessed_at });
      return;
    }

    const head = store.latest();
    if (head !== undefined && receipt.chain_head_index <= head.chain_head_index) {
      res.status(409).json({
        error: {
          code: 'STALE_RECEIPT',
          message: `chain_head_index ${receipt.chain_head_index} does not advance the stored head ${head.chain_head_index}`
        }
      });
      return;
    }

    const ack = newAck();
    const stored: StoredAnchorReceipt = { ...receipt, ...ack };
    store.insert(stored);
    res.status(201).json({ receipt_id: stored.receipt_id, witness_ack: ack.witness_ack, witnessed_at: ack.witnessed_at });
  });

  app.get('/anchors', requireApiKey, (_req, res) => {
    res.json({ receipts: store.list() });
  });

  app.get('/anchors/latest', requireApiKey, (_req, res) => {
    const head = store.latest();
    if (head === undefined) {
      res.status(404).json({ error: { code: 'NO_ANCHOR', message: 'No anchor receipts stored yet' } });
      return;
    }
    res.json({ receipt: head });
  });

  app.get('/anchors/:receiptId', requireApiKey, (req, res) => {
    const found = store.get(req.params.receiptId as string);
    if (found === undefined) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown receipt_id' } });
      return;
    }
    res.json({ receipt: found });
  });

  return app;
}

// Default singleton: preserves the existing `app` export and boot behaviour.
const app = createWitnessApp();

const port = parseInt(process.env.PORT || '9090', 10);

if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(port, () => {
    // Log the ACTUAL bound port (not the requested one) so operators and
    // integration harnesses can discover an ephemeral PORT=0 binding.
    const address = server.address();
    const actual =
      typeof address === 'object' && address !== null ? (address as { port: number }).port : port;
    console.log(`GridVault witness service listening on port ${actual}`);
  });
}

export { app };
