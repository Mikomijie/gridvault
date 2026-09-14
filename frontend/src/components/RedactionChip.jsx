import React from 'react';
import en from '../i18n/en.json';

/**
 * RedactionChip (AT-624). Renders the server-supplied reason for a hidden
 * field. There is deliberately no role-based logic here: the server's
 * `_meta.redactions` array is the only source of truth for what is hidden
 * and why. A hostile client receives exactly the same bytes.
 */
export default function RedactionChip({ redaction }) {
  const reason = redaction?.reason_code ?? 'UNKNOWN';
  const text =
    (en.redaction.reasons && en.redaction.reasons[reason]) || `${en.redaction.label}: ${reason}`;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#eaedff] text-[11px] font-bold text-[#404752]"
      title={text}
      aria-label={text}
    >
      <span aria-hidden="true">🔒</span>
      {text}
    </span>
  );
}
