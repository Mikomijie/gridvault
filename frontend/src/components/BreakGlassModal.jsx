import React, { useEffect, useRef, useState } from 'react';
import en from '../i18n/en.json';

/**
 * BreakGlassModal (P8, AT-204/608). Consequence first, then justification,
 * then PIN, then a single red confirm: two interactions after the opening
 * button. Escape cancels and Tab/Shift+Tab are trapped inside the dialog
 * (AT-619). The grant itself is announced by EmergencyBanner's role="alert"
 * once it mounts, not from here — the caller closes this modal as soon as
 * the request succeeds, so anything this component set after that await
 * would be applied to an already-unmounted instance. Nothing here grants
 * anything — POST /override/execute decides server-side.
 */
export default function BreakGlassModal({ hospitalNumber, onConfirm, onCancel, confirming, serverError }) {
  const [code, setCode] = useState('ACUTE_TRAUMA_UNCONSCIOUS');
  const [notes, setNotes] = useState('');
  const [pin, setPin] = useState('');
  const dialogRef = useRef(null);

  const getFocusable = () => {
    if (dialogRef.current === null) return [];
    return Array.from(
      dialogRef.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter((el) => !el.disabled);
  };

  useEffect(() => {
    // The confirm button starts disabled (no PIN yet), and a disabled
    // element cannot receive focus — autofocus the first real field
    // instead so the trap always has a valid starting point.
    getFocusable()[0]?.focus();
    const onKey = (event) => {
      if (event.key === 'Escape') {
        onCancel();
        return;
      }
      // Focus trap (AT-619): Tab/Shift+Tab cycle within the dialog only —
      // a screen-reader or keyboard user must never land on the roster
      // behind the scrim while emergency access is being decided.
      if (event.key !== 'Tab') return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const needsNotes = code === 'OTHER';
  const notesOk = !needsNotes || notes.trim().length >= 20;
  const canConfirm = pin.trim().length > 0 && notesOk && !confirming;

  const submit = async (event) => {
    event.preventDefault();
    if (!canConfirm) return;
    // Errors are surfaced by the caller re-rendering this modal with
    // `serverError`; a rejection here needs no local handling.
    await onConfirm({ justification_code: code, justification_notes: notes.trim() || null, pin }).catch(() => undefined);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="breakglass-title"
      ref={dialogRef}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"
      >
        <h2 id="breakglass-title" className="text-[18px] font-bold text-[#93000a]">
          Emergency Clinical Override
        </h2>
        <p className="mt-2 text-[14px] text-[#131b2e]">
          This opens <span className="font-mono font-bold">{hospitalNumber}</span> outside your
          normal access and immediately notifies the CMO and the charge nurse. The grant is
          scoped to this patient for 60 minutes and written to the tamper-evident audit log.
        </p>
        <label className="mt-4 block text-[12px] font-bold text-[#131b2e]" htmlFor="bg-reason">
          Clinical justification
        </label>
        <select
          id="bg-reason"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="mt-1 h-10 w-full rounded-lg bg-[#f2f3ff] px-3 text-[14px]"
        >
          {en.breakGlass.codes.map((entry) => (
            <option key={entry.code} value={entry.code}>
              {entry.label}
            </option>
          ))}
        </select>

        {needsNotes && (
          <>
            <label className="mt-3 block text-[12px] font-bold text-[#131b2e]" htmlFor="bg-notes">
              Notes (minimum 20 characters)
            </label>
            <textarea
              id="bg-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg bg-[#f2f3ff] p-3 text-[14px]"
            />
          </>
        )}

        <label className="mt-3 block text-[12px] font-bold text-[#131b2e]" htmlFor="bg-pin">
          Confirm with your PIN
        </label>
        <input
          id="bg-pin"
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          className="mt-1 h-10 w-full rounded-lg bg-[#f2f3ff] px-3 text-[14px]"
          autoComplete="off"
        />

        {serverError && (
          <p role="alert" className="mt-3 rounded-lg bg-[#ffdad6] px-3 py-2 text-[13px] font-semibold text-[#93000a]">
            {serverError}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-[13px] font-bold text-[#404752] hover:bg-[#eaedff]"
          >
            {en.breakGlass.cancel}
          </button>
          <button
            type="submit"
            disabled={!canConfirm}
            className="rounded-lg bg-[#b6171e] px-5 py-2 text-[14px] font-bold text-white disabled:opacity-50"
          >
            {confirming ? en.breakGlass.confirming : en.breakGlass.confirm}
          </button>
        </div>
      </form>
    </div>
  );
}
