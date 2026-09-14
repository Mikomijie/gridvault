import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';
import en from '../i18n/en.json';

/**
 * EmergencyBanner (P8, AT-609). Fixed red banner while any break-glass
 * grant is ACTIVE, with a live countdown and End emergency access. Ending
 * re-locks the chart on next navigation because grants are resolved
 * server-side per request.
 */
export default function EmergencyBanner() {
  const { activeGrants, lastOverride, refreshMe, setLastOverride } = useAuth();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    if (activeGrants.length === 0) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activeGrants.length]);

  if (activeGrants.length === 0) return null;

  const countdown = (expiresAt) => {
    const ms = Math.max(0, Date.parse(expiresAt) - nowMs);
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  };

  const endAll = async () => {
    setEnding(true);
    try {
      for (const grant of activeGrants) {
        await api.overrideClose(grant.id);
      }
      setLastOverride(null);
      await refreshMe();
    } finally {
      setEnding(false);
    }
  };

  return (
    <div className="sticky top-0 z-40 bg-[#b6171e] px-4 py-2 text-white" role="alert" aria-live="assertive">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-bold">
          {en.emergency.active}{' '}
          {lastOverride?.audit_index != null && (
            <span className="font-mono">audit {lastOverride.audit_index} · </span>
          )}
          {activeGrants.map((grant) => (
            <span key={grant.id} className="font-mono">
              {grant.patient_id} ({countdown(grant.expires_at)})
            </span>
          ))}
        </p>
        <button
          type="button"
          onClick={endAll}
          disabled={ending}
          className="rounded-lg bg-white px-3 py-1 text-[12px] font-bold text-[#b6171e] disabled:opacity-60"
        >
          {en.emergency.end}
        </button>
      </div>
    </div>
  );
}
