// GridVault tamper demonstration (PRD 12.5, AGENTS.md P2).
//
// This module simulates exactly what an attacker with host access would do:
// open the database file directly (bypassing the application entirely),
// drop the append-only triggers, mutate one row, and reinstall the triggers
// to cover their tracks. The hash chain — and the external witness — are
// what catch them afterwards.
//
// There is deliberately no HTTP endpoint that reaches this code. The only
// caller is the operator CLI, which refuses to run under
// NODE_ENV=production without an explicit acknowledgement flag.

import Database from 'better-sqlite3';

/** Content columns the demo may rewrite. Hash and index columns are refused:
// silently editing a hash is not the attack this demonstrates, and the
// refusal itself documents that hashes are derived, not authored. */
const TAMPERABLE_FIELDS = [
  'staff_id',
  'staff_role',
  'ward',
  'patient_id',
  'action',
  'details',
  'timestamp',
  'session_id',
  'terminal_id',
  'source_ip'
] as const;

export type TamperableField = (typeof TAMPERABLE_FIELDS)[number];

const TAMPERABLE_SET: ReadonlySet<string> = new Set(TAMPERABLE_FIELDS);

export function isTamperableField(field: string): field is TamperableField {
  return TAMPERABLE_SET.has(field);
}

export class TamperRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TamperRefusedError';
  }
}

export interface DemoTamperInput {
  /** 1-based log_index of the row to rewrite. */
  index: number;
  field: string;
  /** Replacement value. Defaults to a field-appropriate attacker marker. */
  value?: string;
  /** Required when NODE_ENV=production. There is no other override. */
  allowProductionCorruption?: boolean;
}

export interface DemoTamperResult {
  index: number;
  field: TamperableField;
  previous: string | null;
  next: string;
}

const CREATE_UPDATE_TRIGGER =
  'CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs ' +
  "BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;";

const CREATE_DELETE_TRIGGER =
  'CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs ' +
  "BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;";

function defaultValueFor(field: TamperableField): string {
  if (field === 'details') {
    return '{"tampered":true}';
  }
  if (field === 'timestamp') {
    return '2026-09-13T10:00:00.000+01:00';
  }
  return 'ATTACKER';
}

function productionGuard(input: DemoTamperInput): void {
  if (process.env.NODE_ENV === 'production' && input.allowProductionCorruption !== true) {
    throw new TamperRefusedError(
      'demo:tamper refuses to corrupt a production ledger without --i-understand-this-corrupts-the-ledger'
    );
  }
}

/**
 * Rewrite one audit_logs cell via direct file access. Opens its own
 * connection to `dbPath` (WAL siblings alongside it are honoured by
 * SQLite), drops both append-only triggers, performs the UPDATE the
 * triggers would have aborted, then reinstalls the triggers byte-identical
 * to migration 001.
 */
export function demoTamper(dbPath: string, input: DemoTamperInput): DemoTamperResult {
  productionGuard(input);
  if (!Number.isInteger(input.index) || input.index < 1) {
    throw new TamperRefusedError(`demo:tamper requires a 1-based --index, got ${String(input.index)}`);
  }
  if (!isTamperableField(input.field)) {
    throw new TamperRefusedError(
      `demo:tamper refuses field '${input.field}': tamperable fields are ${TAMPERABLE_FIELDS.join(', ')}`
    );
  }
  const next = input.value ?? defaultValueFor(input.field);

  const db = new Database(dbPath);
  try {
    const existing = db
      .prepare('SELECT * FROM audit_logs WHERE log_index = ?')
      .get(input.index) as Record<string, unknown> | undefined;
    if (existing === undefined) {
      throw new TamperRefusedError(`demo:tamper: no audit_logs row at index ${input.index}`);
    }
    const previous = existing[input.field] as string | null;

    // The attack: triggers first, exactly as a host intruder would.
    db.exec('DROP TRIGGER IF EXISTS audit_logs_no_update');
    db.exec('DROP TRIGGER IF EXISTS audit_logs_no_delete');
    // The column name is drawn from a fixed allowlist above, so this is
    // not injectable; the value itself is always bound. Concatenation (not
    // a template literal) matches the repository convention and keeps the
    // no-template-literal-sql lint rule green.
    db.prepare('UPDATE audit_logs SET ' + input.field + ' = ? WHERE log_index = ?').run(
      next,
      input.index
    );
    db.exec(CREATE_UPDATE_TRIGGER);
    db.exec(CREATE_DELETE_TRIGGER);

    const triggers = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'audit_logs_no_%'")
      .all() as Array<{ name: string }>;
    if (triggers.length !== 2) {
      throw new TamperRefusedError('demo:tamper failed to reinstall the append-only triggers');
    }
    return { index: input.index, field: input.field, previous, next };
  } finally {
    db.close();
  }
}
