import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { enqueueMutation, listQueuedMutations, removeQueuedMutation } from '../lib/queue.js';
import { BASE_URL, api } from '../lib/api.js';

const OfflineContext = createContext(null);

const HEARTBEAT_MS = Number(import.meta.env.VITE_HEARTBEAT_MS ?? 10000);
const FAILURES_TO_OFFLINE = Number(import.meta.env.VITE_OFFLINE_FAILURES ?? 3);

/**
 * OfflineProvider (P7 frontend half). Declares the terminal offline after
 * three consecutive failed heartbeats against GET /api/health/ping —
 * navigator.onLine alone is not trusted (a Wi-Fi router with a dead uplink
 * still reports "online"). One success flips back and drains the mutation
 * queue in device_seq order.
 */
export function OfflineProvider({ children }) {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [queued, setQueued] = useState(0);
  const [queuedIds, setQueuedIds] = useState([]);
  const [lastSyncedCount, setLastSyncedCount] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  // Labelled outage simulation (AT-615, demos): forces the offline path —
  // queueing, banners, deferred sync — without touching the network.
  const [simulated, setSimulated] = useState(false);
  const failures = useRef(0);
  // Ref mirrors of state for the heartbeat interval. State updaters must
  // stay pure (StrictMode double-invokes them in dev, which once fired the
  // reconnect drain twice and the second empty drain overwrote the synced
  // count with zero), so the flip-and-drain decision lives here instead.
  const onlineRef = useRef(online);
  const syncingRef = useRef(false);

  const refreshQueueCount = useCallback(async () => {
    try {
      const rows = await listQueuedMutations();
      setQueued(rows.length);
      setQueuedIds(rows.map((row) => row.client_mutation_id));
    } catch {
      // IndexedDB unavailable (private mode): queue depth unknown, capture
      // still attempted in memory by callers.
    }
  }, []);

  const syncNow = useCallback(async () => {
    if (simulated || syncingRef.current) return { synced: 0, deferred: true };
    const pending = await listQueuedMutations();
    if (pending.length === 0) return { synced: 0 };
    syncingRef.current = true;
    setSyncing(true);
    try {
      const res = await api.syncBatch(pending);
      const done = new Set((res.data?.results ?? []).filter((r) => r.status !== 'error').map((r) => r.client_mutation_id));
      for (const id of done) {
        await removeQueuedMutation(id).catch(() => undefined);
      }
      setLastSync(new Date().toISOString());
      setLastSyncedCount(done.size);
      await refreshQueueCount();
      return { synced: done.size };
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [refreshQueueCount]);

  const enqueue = useCallback(
    async (mutation) => {
      await enqueueMutation(mutation);
      await refreshQueueCount();
    },
    [refreshQueueCount]
  );

  useEffect(() => {
    refreshQueueCount().catch(() => undefined);
    if (simulated) {
      failures.current = FAILURES_TO_OFFLINE;
      onlineRef.current = false;
      setOnline(false);
      return undefined;
    }
    const base = BASE_URL;
    const beat = async () => {
      try {
        const res = await fetch(`${base}/api/health/ping`, { method: 'GET' });
        if (!res.ok) throw new Error('heartbeat failed');
        failures.current = 0;
        if (!onlineRef.current) {
          onlineRef.current = true;
          setOnline(true);
          syncNow().catch(() => undefined);
        }
      } catch {
        failures.current += 1;
        if (failures.current >= FAILURES_TO_OFFLINE && onlineRef.current) {
          onlineRef.current = false;
          setOnline(false);
        }
      }
    };
    const timer = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [refreshQueueCount, syncNow, simulated]);

  const value = useMemo(
    () => ({ online: simulated ? false : online, queued, queuedIds, syncing, lastSync, lastSyncedCount, simulated, setSimulated, enqueue, syncNow, refreshQueueCount }),
    [online, queued, queuedIds, syncing, lastSync, lastSyncedCount, simulated, enqueue, syncNow, refreshQueueCount]
  );
  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline() {
  const ctx = useContext(OfflineContext);
  if (ctx === null) throw new Error('useOffline must be used inside OfflineProvider');
  return ctx;
}
