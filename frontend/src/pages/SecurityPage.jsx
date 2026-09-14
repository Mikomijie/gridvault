import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';
import { useSse } from '../lib/useSse.js';
import en from '../i18n/en.json';
import EmergencyBanner from '../components/EmergencyBanner.jsx';

/**
 * SecurityPage (P8, AT-610..614). Ledger inspector with truncated hashes
 * and filters, chain verifier with HEALTHY/TAMPERED banners naming
 * broken_at_index and failure_kind, live abuse feed over SSE with a Run
 * abuse demonstration button (genuine probe, never fabricated), and the
 * override review queue where the CMO acknowledges grants.
 */
export default function SecurityPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('ledger');
  const [logs, setLogs] = useState([]);
  const [actionFilter, setActionFilter] = useState('');
  const [staffFilter, setStaffFilter] = useState('');
  const [verify, setVerify] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [overrides, setOverrides] = useState([]);
  const [notice, setNotice] = useState(null);
  const [demoRunning, setDemoRunning] = useState(false);

  const loadLogs = useCallback(async () => {
    const params = { limit: 100 };
    if (actionFilter.trim().length > 0) params.action = actionFilter.trim();
    if (staffFilter.trim().length > 0) params.staff_id = staffFilter.trim();
    const res = await api.auditLogs(params);
    setLogs(res.data ?? []);
  }, [actionFilter, staffFilter]);

  const loadAlerts = useCallback(async () => {
    const res = await api.abuseAlerts({ limit: 50 });
    setAlerts(res.data ?? []);
  }, []);

  const loadOverrides = useCallback(async () => {
    const res = await api.overrideQueue();
    setOverrides(res.data?.overrides ?? res.data ?? []);
  }, []);

  useEffect(() => {
    loadLogs().catch(() => undefined);
    loadAlerts().catch(() => undefined);
    loadOverrides().catch(() => undefined);
  }, [loadLogs, loadAlerts, loadOverrides]);

  useSse('/api/abuse/stream', {
    onEvent: (row) => {
      setAlerts((prev) => (prev.some((alert) => alert.id === row.id) ? prev : [row, ...prev]));
    }
  });

  const runVerify = async () => {
    setVerifying(true);
    try {
      const res = await api.auditVerify();
      setVerify(res);
      // A break changes what the inspector must show: reload so the
      // offending row renders (highlighted) without a manual refresh.
      if (res.status !== 'HEALTHY') await loadLogs();
    } finally {
      setVerifying(false);
    }
  };

  const runDemo = async () => {
    setDemoRunning(true);
    setNotice(null);
    try {
      const res = await api.abuseDemo();
      setNotice(
        res.data?.genuine === true
          ? `Genuine denial replayed as RC-1029 (${res.data.denial?.reason_code}); alert ${res.data.alert?.id ?? ''} arrived over the live feed.`
          : 'Probe completed but genuineness could not be confirmed — investigate.'
      );
      await loadAlerts();
    } catch (err) {
      setNotice(err.message);
    } finally {
      setDemoRunning(false);
    }
  };

  const acknowledge = async (id) => {
    await api.overrideReview(id, 'acknowledged', 'Reviewed from the security console.');
    setNotice(`Override ${id} acknowledged and written to the ledger.`);
    await loadOverrides();
  };

  const shortHash = (hash) =>
    typeof hash === 'string' && hash.length > 16 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash;

  return (
    <div className="min-h-screen bg-[#faf8ff] font-sans text-[#131b2e]">
      <EmergencyBanner />
      <main className="mx-auto max-w-6xl p-4 md:p-6">
        <h1 className="text-[22px] font-bold">{en.security.title}</h1>
        <p className="text-[13px] text-[#404752]">
          {en.security.signedInAs} {user?.staff_id ?? ''} ({user?.role ?? ''})
        </p>
        {notice && (
          <p role="status" className="mt-3 rounded-lg bg-[#eaedff] px-4 py-2 text-[13px] font-semibold">
            {notice}
          </p>
        )}

        <div className="mt-3 flex gap-1 border-b border-[#c0c7d4]" role="tablist" aria-label={en.security.tabs}>
          {['ledger', 'verify', 'abuse', 'overrides'].map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              onClick={() => setTab(name)}
              className={`px-4 py-2 text-[13px] font-bold ${tab === name ? 'border-b-2 border-[#005ea4] text-[#005ea4]' : 'text-[#404752]'}`}
            >
              {en.security[`tab_${name}`] ?? name}
            </button>
          ))}
        </div>

        {tab === 'ledger' && (
          <div role="tabpanel" className="mt-4 rounded-xl bg-white p-4 shadow-sm">
            <form
              className="mb-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                loadLogs().catch(() => undefined);
              }}
            >
              <input
                aria-label={en.security.filterAction}
                placeholder={en.security.filterAction}
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
                className="h-9 rounded-lg bg-[#f2f3ff] px-3 text-[13px]"
              />
              <input
                aria-label={en.security.filterStaff}
                placeholder={en.security.filterStaff}
                value={staffFilter}
                onChange={(e) => setStaffFilter(e.target.value)}
                className="h-9 rounded-lg bg-[#f2f3ff] px-3 text-[13px]"
              />
              <button type="submit" className="rounded-lg bg-[#005ea4] px-4 text-[13px] font-bold text-white">
                {en.security.apply}
              </button>
            </form>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="text-[#707783]">
                    <th className="px-2 py-1">#</th>
                    <th className="px-2 py-1">time</th>
                    <th className="px-2 py-1">staff</th>
                    <th className="px-2 py-1">action</th>
                    <th className="px-2 py-1">patient</th>
                    <th className="px-2 py-1">hash</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((row) => {
                    const broken = verify !== null && verify.broken_at_index === row.log_index;
                    return (
                      <tr key={row.log_index} className={broken ? 'bg-[#ffdad6] font-bold' : 'odd:bg-[#faf8ff]'}>
                        <td className="px-2 py-1 font-mono">{row.log_index}</td>
                        <td className="px-2 py-1">{row.timestamp}</td>
                        <td className="px-2 py-1">{row.staff_id}</td>
                        <td className="px-2 py-1">{row.action}</td>
                        <td className="px-2 py-1 font-mono">{row.patient_id}</td>
                        <td className="px-2 py-1 font-mono" title={row.current_hash}>
                          {shortHash(row.current_hash)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'verify' && (
          <div role="tabpanel" className="mt-4 rounded-xl bg-white p-4 shadow-sm">
            <button
              type="button"
              onClick={runVerify}
              disabled={verifying}
              className="rounded-lg bg-[#005ea4] px-5 py-2 text-[14px] font-bold text-white disabled:opacity-60"
            >
              {verifying ? en.security.verifying : en.security.verifyChain}
            </button>
            {verify !== null && (
              <div
                role={verify.status === 'HEALTHY' ? 'status' : 'alert'}
                className={`mt-3 rounded-lg px-4 py-3 text-[14px] font-bold ${verify.status === 'HEALTHY' ? 'bg-[#81f3e5]/30 text-[#006a62]' : 'bg-[#ffdad6] text-[#93000a]'}`}
              >
                {verify.status === 'HEALTHY'
                  ? `${en.security.healthy}: ${verify.total_records} entries in ${verify.duration_ms} ms`
                  : `${en.security.tampered}: index ${verify.broken_at_index} (${verify.failure_kind})`}
              </div>
            )}
          </div>
        )}

        {tab === 'abuse' && (
          <div role="tabpanel" className="mt-4 rounded-xl bg-white p-4 shadow-sm">
            <button
              type="button"
              onClick={runDemo}
              disabled={demoRunning}
              className="rounded-lg bg-[#b6171e] px-5 py-2 text-[14px] font-bold text-white disabled:opacity-60"
            >
              {en.security.runDemo}
            </button>
            <ul className="mt-3 flex flex-col gap-2" aria-live="polite">
              {alerts.map((alert) => (
                <li key={alert.id} className="rounded-lg border border-[#c0c7d4] p-3 text-[13px]">
                  <span
                    className={`mr-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${alert.severity === 'CRITICAL' ? 'bg-[#ffdad6] text-[#93000a]' : 'bg-[#eaedff] text-[#404752]'}`}
                  >
                    {alert.severity}
                  </span>
                  <span className="font-mono">{alert.rule_triggered}</span> · {alert.staff_id} →{' '}
                  <span className="font-mono">{alert.patient_id}</span> · {alert.status}
                  <span className="block text-[12px] text-[#707783]">
                    {alert.terminal_id ?? ''} {alert.source_ip ?? ''} · {alert.timestamp}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab === 'overrides' && (
          <div role="tabpanel" className="mt-4 rounded-xl bg-white p-4 shadow-sm">
            <ul className="flex flex-col gap-2">
              {overrides.map((grant) => (
                <li key={grant.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#c0c7d4] p-3 text-[13px]">
                  <span>
                    <span className="font-mono">{grant.id}</span> · {grant.staff_id} →{' '}
                    <span className="font-mono">{grant.patient_id}</span> · {grant.state} ·{' '}
                    {grant.review_state}
                  </span>
                  {grant.review_state === 'PENDING_REVIEW' && (
                    <button
                      type="button"
                      onClick={() => acknowledge(grant.id).catch(() => undefined)}
                      className="rounded-lg bg-[#005ea4] px-3 py-1 text-[12px] font-bold text-white"
                    >
                      {en.security.acknowledge}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}
