// Witness anchor-receiver tests: custody, validation, append-only semantics.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createWitnessApp } from '../../src/index.js';
import { createMemoryStore, openDurableStore, WitnessStoreError } from '../../src/store.js';

const API_KEY = 'witness-test-key-34567890123456789012';

interface Started {
  url: string;
  close: () => Promise<void>;
}

async function start(apiKey: string | undefined): Promise<Started> {
  const witness = createWitnessApp({ apiKey, store: createMemoryStore() });
  const server = witness.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? (address as { port: number }).port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => {
          if (error !== undefined) {
            reject(error);
          } else {
            resolve();
          }
        });
      })
  };
}

function receipt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    receipt_id: 'anc_testreceipt000000000000000001',
    facility_id: 'lasuth-ikeja',
    chain_head_index: 5,
    chain_head_hash: 'a'.repeat(64),
    entry_count: 5,
    anchored_at: '2026-09-13T11:00:00.000+01:00',
    node_signature: `ed25519:${Buffer.alloc(64, 7).toString('base64')}`,
    ...overrides
  };
}

async function post(url: string, body: unknown, key?: string): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (key !== undefined) {
    headers['authorization'] = `Bearer ${key}`;
  }
  const res = await fetch(`${url}/anchors`, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as unknown };
}

describe('witness anchor receiver', () => {
  it('stores a valid receipt (201) and serves it back over GET', async () => {
    const server = await start(API_KEY);
    try {
      const created = await post(server.url, receipt(), API_KEY);
      expect(created.status).toBe(201);
      const ack = created.json as { receipt_id: string; witness_ack: string; witnessed_at: string };
      expect(ack.receipt_id).toBe('anc_testreceipt000000000000000001');
      expect(ack.witness_ack.startsWith('wit_')).toBe(true);

      const listed = await fetch(`${server.url}/anchors`, {
        headers: { authorization: `Bearer ${API_KEY}` }
      });
      expect(listed.status).toBe(200);
      const listBody = (await listed.json()) as { receipts: Array<{ receipt_id: string }> };
      expect(listBody.receipts.map((r) => r.receipt_id)).toEqual(['anc_testreceipt000000000000000001']);

      const latest = await fetch(`${server.url}/anchors/latest`, {
        headers: { authorization: `Bearer ${API_KEY}` }
      });
      expect(latest.status).toBe(200);
      expect(((await latest.json()) as { receipt: { receipt_id: string } }).receipt.receipt_id).toBe(
        'anc_testreceipt000000000000000001'
      );

      const one = await fetch(`${server.url}/anchors/anc_testreceipt000000000000000001`, {
        headers: { authorization: `Bearer ${API_KEY}` }
      });
      expect(one.status).toBe(200);
      const missing = await fetch(`${server.url}/anchors/anc_nope`, {
        headers: { authorization: `Bearer ${API_KEY}` }
      });
      expect(missing.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('rejects unauthenticated and wrong-key requests with 401', async () => {
    const server = await start(API_KEY);
    try {
      expect((await post(server.url, receipt())).status).toBe(401);
      expect((await post(server.url, receipt(), 'wrong-key')).status).toBe(401);
      const listed = await fetch(`${server.url}/anchors`);
      expect(listed.status).toBe(401);
    } finally {
      await server.close();
    }
  });

  it('rejects malformed receipts with 400 INVALID_RECEIPT and stores nothing', async () => {
    const server = await start(API_KEY);
    try {
      const cases: Array<Record<string, unknown>> = [
        receipt({ chain_head_hash: 'not-hex' }),
        receipt({ chain_head_index: 0 }),
        receipt({ chain_head_index: 1.5 }),
        receipt({ entry_count: 4 }),
        receipt({ entry_count: 0 }),
        receipt({ facility_id: '   ' }),
        receipt({ receipt_id: 'x'.repeat(129) }),
        receipt({ node_signature: 'ed25519:tooshort' }),
        receipt({ anchored_at: 'not-a-date' }),
        receipt({ receipt_id: '' })
      ];
      for (const bad of cases) {
        const res = await post(server.url, bad, API_KEY);
        expect(res.status).toBe(400);
        expect((res.json as { error: { code: string } }).error.code).toBe('INVALID_RECEIPT');
      }
      const listRes = await fetch(`${server.url}/anchors`, {
        headers: { authorization: `Bearer ${API_KEY}` }
      });
      const listed = (await listRes.json()) as { receipts: unknown[] };
      expect(listed.receipts).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it('replays an identical receipt idempotently but refuses a rewritten receipt_id', async () => {
    const server = await start(API_KEY);
    try {
      const first = await post(server.url, receipt(), API_KEY);
      expect(first.status).toBe(201);
      const second = await post(server.url, receipt(), API_KEY);
      expect(second.status).toBe(200);
      expect((second.json as { witness_ack: string }).witness_ack).toBe(
        (first.json as { witness_ack: string }).witness_ack
      );

      const rewritten = await post(server.url, receipt({ chain_head_hash: 'b'.repeat(64) }), API_KEY);
      expect(rewritten.status).toBe(409);
      expect((rewritten.json as { error: { code: string } }).error.code).toBe('DUPLICATE_RECEIPT');
    } finally {
      await server.close();
    }
  });

  it('rejects a new receipt that does not advance the stored head as STALE_RECEIPT', async () => {
    const server = await start(API_KEY);
    try {
      expect((await post(server.url, receipt(), API_KEY)).status).toBe(201);
      const stale = await post(
        server.url,
        receipt({ receipt_id: 'anc_testreceipt000000000000000002', chain_head_index: 5, entry_count: 5 }),
        API_KEY
      );
      expect(stale.status).toBe(409);
      expect((stale.json as { error: { code: string } }).error.code).toBe('STALE_RECEIPT');
      const advanced = await post(
        server.url,
        receipt({ receipt_id: 'anc_testreceipt000000000000000003', chain_head_index: 9, entry_count: 9 }),
        API_KEY
      );
      expect(advanced.status).toBe(201);
    } finally {
      await server.close();
    }
  });

  it('persists receipts across restarts through the durable JSONL store', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gv-witness-'));
    const dataPath = path.join(dir, 'anchors.jsonl');
    const first = openDurableStore(dataPath);
    first.insert({
      receipt_id: 'anc_persist1',
      facility_id: 'lasuth-ikeja',
      chain_head_index: 5,
      chain_head_hash: 'a'.repeat(64),
      entry_count: 5,
      anchored_at: '2026-09-13T11:00:00.000+01:00',
      node_signature: `ed25519:${Buffer.alloc(64, 1).toString('base64')}`,
      witness_ack: 'wit_1',
      witnessed_at: '2026-09-13T11:01:00.000Z'
    });
    const second = openDurableStore(dataPath);
    expect(second.size).toBe(1);
    expect(second.latest()?.receipt_id).toBe('anc_persist1');
  });

  it('refuses to boot from a corrupt data file and orders replayed receipts', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gv-witness-corrupt-'));
    const goodPath = path.join(dir, 'good.jsonl');
    const store = openDurableStore(goodPath);
    const at = (index: number): string => `2026-09-13T11:${String(index).padStart(2, '0')}:00.000+01:00`;
    // Insert out of order: replay must still sort and head at the highest.
    for (const index of [9, 5, 7]) {
      store.insert({
        receipt_id: `anc_replay${index}`,
        facility_id: 'lasuth-ikeja',
        chain_head_index: index,
        chain_head_hash: 'a'.repeat(64),
        entry_count: index,
        anchored_at: at(index),
        node_signature: `ed25519:${Buffer.alloc(64, index).toString('base64')}`,
        witness_ack: `wit_${index}`,
        witnessed_at: '2026-09-13T11:01:00.000Z'
      });
    }
    const replayed = openDurableStore(goodPath);
    expect(replayed.size).toBe(3);
    expect(replayed.list().map((r) => r.chain_head_index)).toEqual([5, 7, 9]);
    expect(replayed.latest()?.receipt_id).toBe('anc_replay9');

    const badPath = path.join(dir, 'bad.jsonl');
    writeFileSync(badPath, '{"receipt_id":"anc_ok"}\nthis is not json\n', 'utf8');
    expect(() => openDurableStore(badPath)).toThrowError(WitnessStoreError);
  });
});
