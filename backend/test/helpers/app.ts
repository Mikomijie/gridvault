// Shared integration-test harness: isolated :memory: database, migrated and
// seeded with the demo profile (fast argon2), mounted on a supertest-ready
// Express app with a fixed clock. Every test gets a fresh stack — no
// cross-test lockout, session or ledger leakage.

import type express from 'express';
import { v7 as uuidv7 } from 'uuid';
import type { GridVaultDatabase } from '../../src/db/connection.js';
import { seedDatabase } from '../../src/db/seed.js';
import { createApp } from '../../src/http/app.js';
import { fixedClock, formatIsoWithOffset, type Clock } from '../../src/clock.js';
import { scheduledExtensionsRepository, usersRepository } from '../../src/db/repositories/users.js';
import { MIGRATIONS_DIR, TEST_CLOCK, TEST_MASTER_KEY, migrateTestDb, openTestDb } from './db.js';

export const TEST_JWT_SECRET = 'gridvault-integration-test-jwt-secret-min-32-chars!!';
export const TEST_TIME_ZONE = 'Africa/Lagos';

/** 11:00 WAT: morning shift on duty, afternoon/night off. */
export const MORNING_CLOCK: Clock = TEST_CLOCK;
/** 16:00 WAT: afternoon shift on duty (morning in grace until 14:30, off after). */
export const AFTERNOON_CLOCK: Clock = fixedClock('2026-09-13T15:00:00Z');

export interface TestStack {
  db: GridVaultDatabase;
  app: express.Express;
  clock: Clock;
}

export function createTestStack(clock: Clock = TEST_CLOCK): TestStack {
  const db = openTestDb();
  migrateTestDb(db);
  const app = createApp({
    db,
    clock,
    timeZone: TEST_TIME_ZONE,
    auth: {
      jwtSecret: TEST_JWT_SECRET,
      demoMode: true,
      masterKey: TEST_MASTER_KEY,
      masterKeyLoaded: true
    }
  });
  return { db, app, clock };
}

export async function createSeededStack(clock: Clock = TEST_CLOCK): Promise<TestStack> {
  const stack = createTestStack(clock);
  await seedDatabase(stack.db, 'demo', {
    masterKey: TEST_MASTER_KEY,
    clock,
    timeZone: TEST_TIME_ZONE,
    migrationsDir: MIGRATIONS_DIR,
    hashStrength: 'fast'
  });
  return stack;
}

/** Insert a sanctioned overtime window around the stack clock so shift never interferes. */
export function makeOnDuty(stack: TestStack, staffId: string): void {
  const user = usersRepository(stack.db).findByStaffId(staffId);
  if (user === undefined) {
    throw new Error(`Unknown staff for makeOnDuty: ${staffId}`);
  }
  const at = stack.clock.now().getTime();
  scheduledExtensionsRepository(stack.db).insert({
    id: uuidv7(),
    user_id: user.id,
    starts_at: new Date(at - 4 * 3600000).toISOString(),
    ends_at: new Date(at + 4 * 3600000).toISOString(),
    approved_by: 'GV-9101',
    reason: 'test cover',
    created_at: formatIsoWithOffset(stack.clock.now(), TEST_TIME_ZONE)
  });
}

export function demoPassword(staffId: string): string {
  return `GridVault-Demo-${staffId}!`;
}
