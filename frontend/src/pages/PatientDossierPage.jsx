import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api, ApiError } from '../lib/api.js';
import en from '../i18n/en.json';
import RedactionChip from '../components/RedactionChip.jsx';
import BreakGlassModal from '../components/BreakGlassModal.jsx';
import EmergencyBanner from '../components/EmergencyBanner.jsx';
import OfflineBar from '../components/OfflineBar.jsx';
import VitalsForm from '../components/VitalsForm.jsx';

const TABS = ['overview', 'vitals', 'clinical', 'protected'];

/**
 * PatientDossierPage (P8, AT-605/606/608/609). Tabs render server DTO
 * groups; a null group renders its RedactionChips from _meta.redactions.
 * The values of restricted fields are absent from the DOM, not blurred
 * (AT-606 asserts via page.content()). Denials name the deciding dimension
 * and offer break-glass exactly when the server allows it.
 */
export default function PatientDossierPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { refreshMe, setLastOverride } = useAuth();
  const [tab, setTab] = useState('overview');
  const [dossier, setDossier] = useState(null);
  const [denial, setDenial] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [modalError, setModalError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setDenial(null);
    try {
      const res = await api.dossier(id);
      setDossier(res);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 403 || err.status === 404 || err.status === 410)) {
        setDenial(err);
        setDossier(null);
      } else {
        setDenial(new ApiError({ status: 0, code: 'LOAD_FAILED', message: en.dossier.loadError }));
        setDossier(null);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const confirmOverride = async ({ justification_code, justification_notes, pin }) => {
    setConfirming(true);
    setModalError(null);
    try {
      const res = await api.overrideExecute({
        patient_id: id,
        justification_code,
        justification_notes,
        pin
      });
      setModalOpen(false);
      setLastOverride({ audit_index: res.data.audit_index, override_id: res.data.override_id });
      await refreshMe().catch(() => undefined);
      await load();
      return res.data;
    } catch (err) {
      setModalError(err.message);
      throw err;
    } finally {
      setConfirming(false);
    }
  };

  const redactionsFor = (group) =>
    (dossier?._meta?.redactions ?? []).filter((entry) => entry.group === group);

  const renderGroup = (group, content) => {
    if (content !== null && content !== undefined) return content;
    const chips = redactionsFor(group);
    if (chips.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-2">
        {chips.map((entry) => (
          <RedactionChip key={`${entry.group}:${entry.field}`} redaction={entry} />
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#faf8ff] font-sans text-[#131b2e]">
      <EmergencyBanner />
      <OfflineBar />
      <main className="mx-auto max-w-5xl p-4 md:p-6" aria-live="polite">
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="text-[13px] font-bold text-[#005ea4] hover:underline"
        >
          {en.dossier.back}
        </button>

        {loading && <p className="mt-6 text-[15px] font-semibold text-[#404752]">{en.dossier.loading}</p>}

        {!loading && denial !== null && (
          <div className="mt-6 rounded-xl bg-white p-6 shadow-sm">
            <h1 className="text-[20px] font-bold">{en.dossier.deniedTitle}</h1>
            <p className="mt-2 text-[14px]">
              {denial.reasonCode === 'WARD_MISMATCH' && en.dossier.deniedWard}
              {denial.reasonCode === 'CLERK_OUT_OF_QUEUE' && en.dossier.deniedQueue}
              {denial.reasonCode === 'GRANT_EXPIRED' && en.dossier.grantExpired}
              {!['WARD_MISMATCH', 'CLERK_OUT_OF_QUEUE', 'GRANT_EXPIRED'].includes(denial.reasonCode ?? '') &&
                en.dossier.deniedGeneric}
            </p>
            {denial.reasonCode && (
              <p className="mt-1 font-mono text-[12px] text-[#707783]">{denial.reasonCode}</p>
            )}
            {denial.canBreakGlass && (
              <button
                type="button"
                onClick={() => {
                  setModalError(null);
                  setModalOpen(true);
                }}
                className="mt-4 rounded-lg bg-[#b6171e] px-5 py-2.5 text-[14px] font-bold text-white"
              >
                {en.dossier.breakGlass}
              </button>
            )}
          </div>
        )}

        {!loading && dossier !== null && (
          <div className="mt-4">
            <h1 className="text-[22px] font-bold">
              {dossier.data.patient?.full_name ?? id} <span className="font-mono text-[14px] text-[#707783]">{id}</span>
            </h1>
            <div className="mt-3 flex gap-1 border-b border-[#c0c7d4]" role="tablist" aria-label={en.dossier.tabs}>
              {TABS.map((name) => (
                <button
                  key={name}
                  type="button"
                  role="tab"
                  aria-selected={tab === name}
                  onClick={() => setTab(name)}
                  className={`px-4 py-2 text-[13px] font-bold ${tab === name ? 'border-b-2 border-[#005ea4] text-[#005ea4]' : 'text-[#707783]'}`}
                >
                  {en.dossier[`tab_${name}`] ?? name}
                </button>
              ))}
            </div>

            <div className="mt-4 rounded-xl bg-white p-5 shadow-sm" role="tabpanel">
              {tab === 'overview' && (
                <dl className="grid grid-cols-1 gap-2 text-[14px] sm:grid-cols-2">
                  {Object.entries(dossier.data.patient ?? {}).map(([key, value]) => (
                    <div key={key} className="flex gap-2">
                      <dt className="font-bold text-[#404752]">{key}:</dt>
                      <dd>{String(value)}</dd>
                    </div>
                  ))}
                  {renderGroup(
                    'LOGISTICS',
                    dossier.data.logistics &&
                      Object.entries(dossier.data.logistics).map(([key, value]) => (
                        <div key={key} className="flex gap-2 text-[14px]">
                          <dt className="font-bold text-[#404752]">{key}:</dt>
                          <dd>{String(value)}</dd>
                        </div>
                      ))
                  )}
                  {(dossier._meta?.redactions ?? []).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2 sm:col-span-2">
                      {(dossier._meta.redactions ?? []).map((entry) => (
                        <RedactionChip key={`${entry.group}:${entry.field}`} redaction={entry} />
                      ))}
                    </div>
                  )}
                </dl>
              )}
              {tab === 'vitals' && (
                <>
                  {renderGroup(
                    'VITALS',
                    dossier.data.vitals?.latest ? (
                      <dl className="grid grid-cols-2 gap-2 text-[14px] sm:grid-cols-4">
                        {Object.entries(dossier.data.vitals.latest).map(([key, value]) => (
                          <div key={key} className="rounded-lg bg-[#eaedff] p-3 text-center">
                            <dt className="text-[11px] font-bold uppercase text-[#404752]">{key}</dt>
                            <dd className="text-[20px] font-bold text-[#005ea4]">{String(value)}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="text-[14px] text-[#707783]">{en.dossier.noVitals}</p>
                    )
                  )}
                  {dossier.data.vitals !== null && (
                    <VitalsForm hospitalNumber={id} onRecorded={() => load().catch(() => undefined)} />
                  )}
                </>
              )}
              {tab === 'clinical' &&
                renderGroup(
                  'CLINICAL',
                  dossier.data.clinical ? (
                    <dl className="grid grid-cols-1 gap-2 text-[14px]">
                      {Object.entries(dossier.data.clinical).map(([key, value]) => (
                        <div key={key} className="flex gap-2">
                          <dt className="font-bold text-[#404752]">{key}:</dt>
                          <dd>{String(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null
                )}
              {tab === 'protected' &&
                renderGroup(
                  'SENSITIVE',
                  dossier.data.sensitive ? (
                    <dl className="grid grid-cols-1 gap-2 text-[14px]">
                      {Object.entries(dossier.data.sensitive).map(([key, value]) => (
                        <div key={key} className="flex gap-2">
                          <dt className="font-bold text-[#404752]">{key}:</dt>
                          <dd>{String(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null
                )}
            </div>
          </div>
        )}

        {modalOpen && (
          <BreakGlassModal
            hospitalNumber={id}
            confirming={confirming}
            serverError={modalError}
            onCancel={() => setModalOpen(false)}
            onConfirm={confirmOverride}
          />
        )}
      </main>
    </div>
  );
}
