// GridVault redaction serializer (PRD 6.4).
//
// Redaction happens here, after policy evaluation, before the response is
// written. Restricted values are never loaded into a DTO: the service only
// decrypts a sensitive field when the Decision allows SENSITIVE, and this
// module turns every denied group into "[RESTRICTED]" (scalars) or null
// (objects/arrays) with a parallel _meta.redactions array carrying the
// server-supplied reason. Components render lock chips from _meta and never
// infer permission from role in JavaScript.

import { POLICY_VERSION } from '../auth/tokens.js';
import type { Decision } from '../policy/decide.js';
import { FIELD_GROUP_MEMBERS, type FieldGroup, type PatientGroup } from '../policy/field-groups.js';
import { REASON_TEXT } from '../policy/reasons.js';

export const RESTRICTED = '[RESTRICTED]';

export interface RedactionEntry {
  field: string;
  group: FieldGroup;
  reason_code: string;
  classification: 'NDPA-2023-SENSITIVE' | 'NDPA-2023-STANDARD';
  can_break_glass: boolean;
}

export interface SerializedMeta {
  redactions: RedactionEntry[];
  policy_version: string;
  decision_id: string;
}

/**
 * Mask a full name for off-ward roster rows: first letter of each part plus
 * bullets (Babatunde Adeleke -> "B•••• A••••"). The plaintext never leaves
 * this function when masked.
 */
export function maskName(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => {
      const first = [...part][0] ?? '•';
      return `${first}••••`;
    })
    .join(' ');
}

/** Build the _meta block for a decision, restricted to the groups evaluated. */
export function buildMeta(decision: Decision, groups: PatientGroup[]): SerializedMeta {
  const redactions: RedactionEntry[] = [];
  for (const group of groups) {
    const verdict = decision.groups[group];
    if (verdict.allowed) {
      continue;
    }
    const members = FIELD_GROUP_MEMBERS[group];
    for (const field of members) {
      redactions.push({
        field,
        group,
        reason_code: verdict.reason_code,
        classification: group === 'SENSITIVE' ? 'NDPA-2023-SENSITIVE' : 'NDPA-2023-STANDARD',
        can_break_glass: verdict.can_break_glass
      });
    }
  }
  return { redactions, policy_version: POLICY_VERSION, decision_id: decision.decision_id };
}

/** Human string for a reason code, for denial screens and lock chips. */
export function reasonText(reasonCode: string): string {
  return REASON_TEXT[reasonCode as keyof typeof REASON_TEXT] ?? 'Access denied by policy';
}
