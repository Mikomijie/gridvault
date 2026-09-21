import React, { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.js';

export default function DemoPersonas({ onSelect }) {
  const [personas, setPersonas] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    apiFetch('/api/auth/personas', { auth: false }).then((response) => {
      if (active) setPersonas(response.data.personas);
    }).catch(() => {
      if (active) setError('Demo accounts are temporarily unavailable. Reload to try again.');
    });
    return () => { active = false; };
  }, []);
  return (
    <section className="mx-auto mb-6 max-w-3xl rounded-lg border border-amber-300 p-4" aria-label="Demo accounts">
      <h2 className="mb-2 font-semibold">Choose a demo account</h2>
      <p className="mb-3 text-sm">Shared fictional accounts are available at any hour. Select one, then sign in.</p>
      {error && <p role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {personas.map((persona) => (
          <button key={persona.staff_id} type="button"
            className="rounded border border-slate-400 px-3 py-2 text-left hover:bg-slate-700"
            onClick={() => onSelect({ staffId: persona.staff_id, password: persona.password })}>
            <span className="block">{persona.full_name} ({persona.role})</span>
            <span className="block text-sm">Demo PIN: {persona.pin}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
