// GridVault policy reason codes (PRD 6.1) with human renderings.
//
// reason_code is returned to the client, written into the audit entry's
// details.decision, and rendered by the UI lock chip. A user is never told
// "no" without being told which dimension said no.

export const POLICY_REASONS = [
  'ACCOUNT_INACTIVE',
  'ACCOUNT_EXPIRED',
  'EMERGENCY_GRANT',
  'CLERK_NO_CLINICAL',
  'CLERK_OUT_OF_QUEUE',
  'ADMIN_NO_CLINICAL',
  'WARD_MISMATCH',
  'OFF_DUTY',
  'HANDOVER_GRACE',
  'OFF_DUTY_WRITE',
  'ROLE_CANNOT_WRITE',
  'ROLE_WARD_DUTY_SATISFIED',
  'LEDGER_ACCESS',
  'LEDGER_FORBIDDEN',
  'QUEUE_ACCESS_DENIED'
] as const;

export type PolicyReason = (typeof POLICY_REASONS)[number];

/** Human strings for lock chips and denial screens. Served from the server. */
export const REASON_TEXT: Record<PolicyReason, string> = {
  ACCOUNT_INACTIVE: 'Account is not active',
  ACCOUNT_EXPIRED: 'Account has expired',
  EMERGENCY_GRANT: 'Emergency clinical override grant',
  CLERK_NO_CLINICAL: 'Restricted to attending clinicians',
  CLERK_OUT_OF_QUEUE: 'Outside your intake queue',
  ADMIN_NO_CLINICAL: 'Administrators cannot access clinical content',
  WARD_MISMATCH: 'Outside your assigned ward — emergency override available',
  OFF_DUTY: 'Outside your duty hours — emergency override available',
  HANDOVER_GRACE: 'Handover grace period — read-only',
  OFF_DUTY_WRITE: 'Writes are not allowed outside duty hours',
  ROLE_CANNOT_WRITE: 'Your role cannot edit this field',
  ROLE_WARD_DUTY_SATISFIED: 'Role, ward and duty satisfied',
  LEDGER_ACCESS: 'Audit access granted',
  LEDGER_FORBIDDEN: 'Audit access is limited to administrators and own-ward doctors',
  QUEUE_ACCESS_DENIED: 'The admissions queue is limited to intake clerks'
};
