// GridVault API bootstrap: config → db → migrate → app → listen.
//
// Migration runs at boot (idempotent, checksummed, forward-only) so a ward
// node that restarts on generator changeover always serves the current
// schema or refuses to start loudly. Anchor signing is best-effort at boot:
// a missing NODE_SIGNING_KEY disables anchor execution with a warning, not
// a silent fallback — the hard production gate arrives with the P3 config
// validator.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { createApp } from './http/app.js';
import type { AnchorServiceConfig } from './ledger/anchor.js';
import { parseNodeSigningKey } from './crypto/signing.js';

function migrationsDir(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
}

function databasePath(): string {
  return process.env.DATABASE_PATH ?? './data/gridvault.db';
}

function anchorConfig(): AnchorServiceConfig | null {
  const rawKey = (process.env.NODE_SIGNING_KEY ?? '').trim();
  if (rawKey.length === 0 || rawKey === 'placeholder_node_signing_key_ed25519') {
    console.warn('anchor signing disabled: NODE_SIGNING_KEY is not configured');
    return null;
  }
  try {
    return {
      facilityId: (process.env.FACILITY_ID ?? '').trim() || 'gridvault-ward-node',
      witnessUrl: (process.env.WITNESS_URL ?? '').trim() || 'http://witness:9090',
      witnessApiKey: (process.env.WITNESS_API_KEY ?? '').trim(),
      nodeSigningKey: parseNodeSigningKey(rawKey)
    };
  } catch (error) {
    console.warn(
      `anchor signing disabled: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

const db =
  process.env.NODE_ENV === 'test' ? openDatabase(':memory:') : openDatabase(databasePath());
migrate(db, { migrationsDir: migrationsDir() });

const app = createApp({ db, anchorConfig: anchorConfig() });

const port = parseInt(process.env.PORT || '8080', 10);

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`GridVault API server listening on port ${port}`);
  });
}

export { app };
