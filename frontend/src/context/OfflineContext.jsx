import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { enqueueMutation, listQueuedMutations, removeQueuedMutation } from '../lib/queue.js';
import { api } from '../lib/api.js';

const OfflineContext = createContext(null);

const HEARTBEAT_MS = 10000;
const FAILURES_TO_OFFLINE = 3;

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
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const failures = useRef(0);

  const refreshQueueCount = useCallback(async () => {
    try {
      const rows = await listQueuedMutations();
      setQueued(rows.length);
    } catch {
      // IndexedDB unavailable (private mode): queue depth unknown, capture
      // still attempted in memory by callers.
    }
  }, []);

  const syncNow = useCallback(async () => {
    const pending = await listQueuedMutations();
    if (pending.length === 0) return { synced: 0 };
    setSyncing(true);
    try {
      const res = await api.syncBatch(pending);
      const done = new Set((res.data?.results ?? []).filter((r) => r.status !== 'error').map((r) => r.client_mutation_id));
      for (const id of done) {
        await removeQueuedMutation(id).catch(() => undefined);
      }
      setLastSync(new Date().toISOString());
      await refreshQueueCount();
      return { synced: done.size };
    } finally {
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
    const base = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080').replace(/\/+$/, '');
    const beat = async () => {
      try {
        const res = await fetch(`${base}/api/health/ping`, { method: 'GET' });
        if (!res.ok) throw new Error('heartbeat failed');
        failures.current = 0;
        setOnline((was) => {
          if (!was) {
            syncNow().catch(() => undefined);
            return true;
          }
          return was;
        });
      } catch {
        failures.current += 1;
        if (failures.current >= FAILURES_TO_OFFLINE) setOnline(false);
      }
    };
    const timer = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [refreshQueueCount, syncNow]);

  const value = useMemo(
    () => ({ online, queued, syncing, lastSync, enqueue, syncNow, refreshQueueCount }),
    [online, queued, syncing, lastSync, enqueue, syncNow, refreshQueueCount]
  );
  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline() {
  const ctx = useContext(OfflineContext);
  if (ctx === null) throw new Error('useOffline must be used inside OfflineProvider');
  return ctx;
}
