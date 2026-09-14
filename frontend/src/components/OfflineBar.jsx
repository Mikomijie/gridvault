import React from 'react';
import { useOffline } from '../context/OfflineContext.jsx';
import en from '../i18n/en.json';

/**
 * OfflineBar (P7 frontend, AT-615). Amber while the terminal is offline
 * (heartbeat failures or the labelled simulation toggle), blue while a
 * sync drains, with queue badge, manual Sync now and last-sync time.
 */
export default function OfflineBar() {
  const { online, queued, syncing, lastSync, lastSyncedCount, simulated, setSimulated, syncNow } = useOffline();

  return (
    <div aria-live="polite">
      {!online && (
        <div className="bg-[#ffb224] px-4 py-2 text-[#131b2e]">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] font-bold">
              {en.offline.bar} · {queued} {en.offline.queued}
              {lastSync !== null && ` · ${en.offline.lastSync}: ${lastSync}`}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => syncNow().catch(() => undefined)}
                disabled={syncing || simulated}
                className="rounded-lg bg-[#131b2e] px-3 py-1 text-[12px] font-bold text-white disabled:opacity-50"
              >
                {syncing ? en.offline.syncing : en.offline.syncNow}
              </button>
              <label className="flex items-center gap-1 text-[12px] font-bold">
                <input
                  type="checkbox"
                  checked={simulated}
                  onChange={(e) => setSimulated(e.target.checked)}
                />
                {en.offline.simulate}
              </label>
            </div>
          </div>
        </div>
      )}
      {online && (
        <div className="sticky top-16 z-30 border-b border-[#c0c7d4] bg-[#faf8ff] px-4 py-1">
          <div className="mx-auto flex max-w-7xl items-center justify-end gap-3">
            {lastSyncedCount !== null && lastSyncedCount > 0 && (
              <span role="status" className="text-[11px] font-bold text-[#006a62]">
                {en.offline.synced} {lastSyncedCount}
              </span>
            )}
            <label className="flex items-center gap-1 text-[11px] font-bold text-[#707783]">
              <input
                type="checkbox"
                checked={simulated}
                onChange={(e) => setSimulated(e.target.checked)}
              />
              {en.offline.simulate}
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
