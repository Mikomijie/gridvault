// AT-625: OfflineProvider queue survives a page reload (IndexedDB persistence).
import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import {
  clearQueuedMutations,
  enqueueMutation,
  listQueuedMutations,
  removeQueuedMutation
} from '../../src/lib/queue.js';

beforeEach(async () => {
  await clearQueuedMutations();
});

describe('AT-625: OfflineProvider queue survives a page reload', () => {
  it('enqueued mutations persist across IndexedDB connections (a reload)', async () => {
    await enqueueMutation({
      client_mutation_id: 'cm_reload_1',
      device_id: 'term-warda-02',
      device_seq: 41,
      type: 'VITALS',
      patient_id: 'HOSP-LOS-2025-081',
      payload: { heart_rate: 80 },
      captured_at: '2026-09-13T10:30:00.000+01:00'
    });
    await enqueueMutation({
      client_mutation_id: 'cm_reload_2',
      device_id: 'term-warda-02',
      device_seq: 42,
      type: 'VITALS',
      patient_id: 'HOSP-LOS-2025-081',
      payload: { heart_rate: 82 },
      captured_at: '2026-09-13T10:31:00.000+01:00'
    });
    // A reload is a fresh connection: list re-opens the database.
    const afterReload = await listQueuedMutations();
    expect(afterReload.map((row) => row.client_mutation_id)).toEqual(['cm_reload_1', 'cm_reload_2']);
    await removeQueuedMutation('cm_reload_1');
    expect((await listQueuedMutations()).map((row) => row.client_mutation_id)).toEqual(['cm_reload_2']);
  });

  it('rejects envelopes without an idempotency key', async () => {
    await expect(enqueueMutation({ device_id: 'x' })).rejects.toThrowError(/client_mutation_id/);
  });
});
