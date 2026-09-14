// GridVault API bootstrap: config → db → migrate → app → listen.
//
// Migration runs at boot (idempotent, checksummed, forward-only) so a ward
// node that restarts on generator changeover always serves the current
// schema or refuses to start loudly. Configuration is validated before
// anything opens: in production a missing key, a short secret, DEMO_MODE or
// missing TLS acknowledgement is a startup refusal, never a silent fallback.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { createApp } from './http/app.js';
import { loadConfig } from './config/env.js';
import type { AnchorServiceConfig } from './ledger/anchor.js';
import { parseNodeSigningKey } from './crypto/signing.js';

function migrationsDir(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
}

function loadConfigOrExit(): ReturnType<typeof loadConfig> {
  try {
    return loadConfig(process.env);
  } catch (error) {
    process.stderr.write(
      `GridVault refuses to start: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exit(1);
  }
}

const config = loadConfigOrExit();

function anchorConfig(): AnchorServiceConfig | null {
  const rawKey = config.NODE_SIGNING_KEY.trim();
  if (rawKey.length === 0 || rawKey === 'placeholder_node_signing_key_ed25519') {
    console.warn('anchor signing disabled: NODE_SIGNING_KEY is not configured');
    return null;
  }
  try {
    return {
      facilityId: config.FACILITY_ID.trim() || 'gridvault-ward-node',
      witnessUrl: config.WITNESS_URL.trim() || 'http://witness:9090',
      witnessApiKey: config.WITNESS_API_KEY.trim(),
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
  config.NODE_ENV === 'test' ? openDatabase(':memory:') : openDatabase(config.DATABASE_PATH);
migrate(db, { migrationsDir: migrationsDir(), timeZone: config.TIMEZONE });

const app = createApp({
  db,
  anchorConfig: anchorConfig(),
  auth: {
    jwtSecret: config.JWT_SECRET.length > 0 ? config.JWT_SECRET : undefined,
    accessTokenTtlMinutes: config.ACCESS_TOKEN_TTL_MINUTES,
    refreshTokenTtlHours: config.REFRESH_TOKEN_TTL_HOURS,
    maxLoginAttempts: config.RATE_LIMIT_LOGIN_ATTEMPTS,
    lockoutMinutes: config.LOGIN_LOCKOUT_MINUTES,
    shiftGraceMinutes: config.SHIFT_GRACE_MINUTES,
    demoMode: config.DEMO_MODE,
    masterKey: config.masterKeyBytes,
    masterKeyLoaded: config.masterKeyBytes !== null,
    migrationsDir: migrationsDir()
  }
});

if (config.NODE_ENV !== 'test') {
  app.listen(config.PORT, () => {
    console.log(`GridVault API server listening on port ${config.PORT}`);
  });
}

export { app };
