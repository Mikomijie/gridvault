// GridVault API bootstrap: config → db → migrate → app → listen.
//
// Migration runs at boot (idempotent, checksummed, forward-only) so a ward
// node that restarts on generator changeover always serves the current
// schema or refuses to start loudly. Configuration is validated before
// anything opens: in production a missing key, a short secret, DEMO_MODE or
// missing TLS acknowledgement is a startup refusal, never a silent fallback.

import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { createApp } from './http/app.js';
import { loadConfig } from './config/env.js';
import { loadAbuseRules } from './abuse/config.js';
import { loadJustifications } from './override/service.js';
import type { AnchorServiceConfig } from './ledger/anchor.js';
import { parseNodeSigningKey } from './crypto/signing.js';
import { seedDatabase, DEMO_STAFF } from './db/seed.js';
import { usersRepository, scheduledExtensionsRepository } from './db/repositories/users.js';
import { randomUUID } from 'node:crypto';

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

try {
  loadAbuseRules();
} catch (error) {
  process.stderr.write(
    `GridVault refuses to start: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
}
try {
  loadJustifications();
} catch (error) {
  process.stderr.write(
    `GridVault refuses to start: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
}

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

if (config.PUBLIC_DEMO && usersRepository(db).count() === 0) {
  if (config.masterKeyBytes === null) throw new Error('Public demo requires a master key');
  await seedDatabase(db, 'demo', { hashStrength: 'fast', masterKey: config.masterKeyBytes });

  for (const staff of DEMO_STAFF) {
    const user = usersRepository(db).findByStaffId(staff.staffId);
    if (user === undefined) throw new Error('Demo provisioning failed');
    scheduledExtensionsRepository(db).insert({
      id: randomUUID(),
      user_id: user.id,
      starts_at: new Date().toISOString(),
      ends_at: '2099-01-01T00:00:00.000Z',
      approved_by: 'GV-9101',
      reason: 'Fictional-data public demo: all-hours evaluator access',
      created_at: new Date().toISOString()
    });
  }
  console.log('Public demo seeded with', DEMO_STAFF.length, 'staff and scheduled extensions.');
}

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
    overrideTtlMinutes: config.OVERRIDE_TTL_MINUTES,
    demoMode: config.DEMO_MODE,
    masterKey: config.masterKeyBytes,
    masterKeyLoaded: config.masterKeyBytes !== null,
    corsAllowedOrigins: config.CORS_ALLOWED_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    migrationsDir: migrationsDir()
  }
});

if (config.NODE_ENV !== 'test') {
  app.listen(config.PORT, () => {
    console.log(`GridVault API server listening on port ${config.PORT}`);
  });
}

export { app };