import React, { useState } from 'react';
import { api } from '../lib/api.js';
import { useOffline } from '../context/OfflineContext.jsx';
import en from '../i18n/en.json';

// Clinical validity mirrors assertVitalsInput in records/service.ts exactly
// (AT-616): the client rejects with the same message the server would send,
// naming fields only — values stay out of messages either way.
function validateVitals(values) {
  const problems = [];
  const heartRate = Number(values.heart_rate);
  if (!Number.isInteger(heartRate) || heartRate < 20 || heartRate > 250) problems.push('heart_rate');
  if (!/^\d{2,3}\s*\/\s*\d{2,3}$/.test(String(values.blood_pressure ?? '').trim())) problems.push('blood_pressure');
  const spo2 = Number(values.spo2);
  if (!Number.isInteger(spo2) || spo2 < 50 || spo2 > 100) problems.push('spo2');
  const temperature = Number(values.temperature);
  if (Number.isNaN(temperature) || temperature < 30.0 || temperature > 45.0) problems.push('temperature');
  return problems;
}

/**
 * VitalsForm (P8, AT-616). Online it POSTs to the records API; offline it
 * queues the mutation for sync replay with an unsynced tag. Server verdicts
 * (403/422) render verbatim — the server decides, the form reports.
 */
export default function VitalsForm({ hospitalNumber, onRecorded }) {
  const { online, enqueue, queuedIds } = useOffline();
  const [values, setValues] = useState({ heart_rate: '', blood_pressure: '', spo2: '', temperature: '' });
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const [lastQueued, setLastQueued] = useState(null);

  const set = (key) => (event) => {
    setValues((prev) => ({ ...prev, [key]: event.target.value }));
    setError(null);
    setSaved(null);
  };

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setSaved(null);
    const problems = validateVitals(values);
    if (problems.length > 0) {
      setError(`${en.vitals.invalid}: ${problems.join(', ')}`);
      return;
    }
    const payload = {
      heart_rate: Number(values.heart_rate),
      blood_pressure: String(values.blood_pressure).trim(),
      spo2: Number(values.spo2),
      temperature: Number(values.temperature)
    };
    try {
      if (!online) {
        const clientMutationId = `cm_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6)}`;
        await enqueue({
          client_mutation_id: clientMutationId,
          device_id: 'ward-terminal',
          device_seq: Date.now(),
          type: 'VITALS',
          patient_id: hospitalNumber,
          payload,
          captured_at: new Date().toISOString(),
          captured_at_source: 'device_clock'
        });
        setLastQueued({ id: clientMutationId, payload });
        setSaved(`${en.vitals.queued} (${en.offline.queued})`);
        // No reload: there is nothing new server-side to show, and refetching
        // offline would replace the cached chart with a denial screen.
      } else {
        await api.recordVitals(hospitalNumber, payload);
        setSaved(en.vitals.saved);
        setValues({ heart_rate: '', blood_pressure: '', spo2: '', temperature: '' });
        onRecorded?.();
      }
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <form onSubmit={submit} className="mt-3 rounded-lg border border-[#c0c7d4] p-4" aria-label={en.vitals.title}>
      <h3 className="text-[14px] font-bold">{en.vitals.title}</h3>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['heart_rate', en.vitals.heartRate],
          ['blood_pressure', en.vitals.bloodPressure],
          ['spo2', en.vitals.spo2],
          ['temperature', en.vitals.temperature]
        ].map(([key, label]) => (
          <label key={key} className="block text-[12px] font-bold text-[#404752]">
            {label}
            <input
              name={key}
              value={values[key]}
              onChange={set(key)}
              inputMode="decimal"
              className="mt-1 h-9 w-full rounded-lg bg-[#f2f3ff] px-2 text-[14px] font-normal"
            />
          </label>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-[#ffdad6] px-3 py-2 text-[13px] font-semibold text-[#93000a]">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="mt-2 text-[13px] font-semibold text-[#006a62]">
          {saved}
        </p>
      )}
      {lastQueued !== null && queuedIds.includes(lastQueued.id) && (
        <div className="mt-2 rounded-lg bg-[#fff4d6] p-3 text-[13px]">
          <span className="mr-2 inline-block rounded-full bg-[#ffb224] px-2 py-0.5 text-[11px] font-bold">
            {en.vitals.unsynced}
          </span>
          {Object.entries(lastQueued.payload)
            .map(([key, value]) => `${key}: ${value}`)
            .join(' · ')}
        </div>
      )}
      <button
        type="submit"
        className="mt-3 rounded-lg bg-[#005ea4] px-4 py-2 text-[13px] font-bold text-white"
      >
        {online ? en.vitals.save : en.vitals.queueOffline}
      </button>
    </form>
  );
}
