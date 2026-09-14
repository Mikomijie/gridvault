import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api, ApiError } from '../lib/api.js';
import en from '../i18n/en.json';
import EmergencyBanner from '../components/EmergencyBanner.jsx';
import OfflineBar from '../components/OfflineBar.jsx';

/**
 * HandoverPage (P8, AT-617). SBAR sheets for the clinician's own ward with
 * the server-rendered watermark (staff name, staff id, terminal, timestamp)
 * shown diagonally on screen and in print. Every render is an
 * EXPORT_HANDOVER ledger entry server-side.
 */
export default function HandoverPage() {
  const { user } = useAuth();
  const [sheet, setSheet] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!user) return;
        const res = await api.handover(user.ward);
        if (!cancelled) setSheet(res.data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : en.handover.loadError);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <div className="min-h-screen bg-[#faf8ff] font-sans text-[#131b2e]">
      <EmergencyBanner />
      <OfflineBar />
      <main className="mx-auto max-w-5xl p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-[22px] font-bold">{en.handover.title}</h1>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-lg bg-[#005ea4] px-4 py-2 text-[13px] font-bold text-white"
          >
            {en.handover.print}
          </button>
        </div>

        {loading && <p className="mt-4 text-[14px] text-[#404752]">{en.handover.loading}</p>}
        {error !== null && (
          <p role="alert" className="mt-4 rounded-lg bg-[#ffdad6] px-4 py-3 text-[14px] font-bold text-[#93000a]">
            {error}
          </p>
        )}

        {!loading && sheet !== null && (
          <div className="relative mt-4">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
            >
              <span className="rotate-[-24deg] whitespace-nowrap text-[13px] font-bold tracking-widest text-[#b6171e]/25">
                {sheet.watermark}
              </span>
            </div>
            <p className="text-[12px] text-[#404752]">
              {en.handover.generated}: {sheet.generated_at} · {en.handover.ward}: {sheet.ward}
            </p>
            <p className="mt-1 font-mono text-[12px] text-[#404752]">{sheet.watermark}</p>
            <div className="mt-3 flex flex-col gap-3">
              {(sheet.patients ?? []).map((entry) => (
                <article key={entry.hospital_number} className="rounded-xl bg-white p-4 shadow-sm">
                  <h2 className="text-[16px] font-bold">
                    {entry.full_name}{' '}
                    <span className="font-mono text-[12px] font-normal text-[#404752]">
                      {entry.hospital_number} · {entry.bed_number} · {entry.status}
                    </span>
                  </h2>
                  <dl className="mt-2 grid grid-cols-1 gap-1 text-[13px] sm:grid-cols-2">
                    {Object.entries(entry.sbar ?? {}).map(([key, value]) => (
                      <div key={key}>
                        <dt className="font-bold uppercase text-[#404752]">{key}</dt>
                        <dd>{String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </article>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
