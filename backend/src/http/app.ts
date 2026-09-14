// GridVault Express application factory.
//
// createApp(db, ...) builds the full API surface over an explicit database
// handle so tests can mount the app on an isolated :memory: database with
// supertest while production boots it over the file database in index.ts.
// Exactly one error middleware terminates the chain: AppErrors serialize to
// the PRD 12.1 error shape, and anything else becomes a generic 500 that
// leaks neither internals nor PHI.
//
// Auth is enforced at the middleware layer with a server-side user reload
// per request; the JWT carries identity claims only. Optional `auth`
// overrides exist for tests — production (index.ts) always passes explicit
// configuration.

import express from 'express';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import type { GridVaultDatabase } from '../db/connection.js';
import type { Clock } from '../clock.js';
import { AuthService } from '../auth/service.js';
import { IpRateLimiter } from '../auth/rate-limit.js';
import { FieldCrypto } from '../crypto/field-encryption.js';
import { SqliteRecordSource } from '../records/source.js';
import { RecordsService } from '../records/service.js';
import { OverridePinThrottle, OverrideService, loadJustifications } from '../override/service.js';
import { createOverrideRouter } from './routes/override.js';
import type { AnchorServiceConfig } from '../ledger/anchor.js';
import { createAuditRouter } from './routes/audit.js';
import { createAuthRouter } from './routes/auth.js';
import { createHealthRouter } from './routes/health.js';
import { createAdmissionsRouter, createHandoverRouter } from './routes/handover.js';
import { createPatientsRouter } from './routes/patients.js';
import { requireAuth } from './middleware/auth.js';
import { securityHeaders } from './middleware/security.js';
import { AppError, toErrorBody } from './errors.js';

/** Test-only JWT secret. Production always passes an explicit secret. */
export const TEST_ONLY_JWT_SECRET = 'gridvault-test-only-jwt-secret-minimum-32-chars!!';

export interface AuthAppConfig {
  jwtSecret?: string;
  accessTokenTtlMinutes?: number;
  refreshTokenTtlHours?: number;
  maxLoginAttempts?: number;
  lockoutMinutes?: number;
  shiftGraceMinutes?: number;
  demoMode?: boolean;
  masterKey?: Uint8Array | null;
  masterKeyLoaded?: boolean;
  migrationsDir?: string | null;
  overrideTtlMinutes?: number;
  justifications?: string[];
}

export interface CreateAppOptions {
  db: GridVaultDatabase;
  clock?: Clock;
  timeZone?: string;
  anchorConfig?: AnchorServiceConfig | null;
  auth?: AuthAppConfig;
}

export function createApp(options: CreateAppOptions): express.Express {
  const authConfig = options.auth ?? {};
  const jwtSecret = authConfig.jwtSecret ?? TEST_ONLY_JWT_SECRET;
  const shiftGraceMinutes = authConfig.shiftGraceMinutes ?? 30;

  const authService = new AuthService({
    db: options.db,
    clock: options.clock,
    timeZone: options.timeZone,
    jwtSecret,
    accessTokenTtlMinutes: authConfig.accessTokenTtlMinutes,
    refreshTokenTtlHours: authConfig.refreshTokenTtlHours,
    maxLoginAttempts: authConfig.maxLoginAttempts,
    lockoutMinutes: authConfig.lockoutMinutes,
    shiftGraceMinutes,
    ipLimiter: new IpRateLimiter({
      maxAttempts: authConfig.maxLoginAttempts ?? 5,
      windowMs: 10 * 60 * 1000,
      lockoutMs: (authConfig.lockoutMinutes ?? 15) * 60000
    })
  });
  const authenticator = requireAuth({
    db: options.db,
    jwtSecret,
    clock: options.clock,
    timeZone: options.timeZone,
    shiftGraceMinutes
  });

  // Field decryption is available only when the node holds the master key;
  // reads that do not need decryption work without it, and anything that
  // does fails closed with ENCRYPTION_UNAVAILABLE (fail loudly, §2.7).
  const masterKey = authConfig.masterKey ?? null;
  // Invalid justification codes fail boot, not the first emergency.
  const justifications = authConfig.justifications ?? loadJustifications().codes;
  const overrideService = new OverrideService({
    db: options.db,
    clock: options.clock,
    timeZone: options.timeZone,
    ttlMinutes: authConfig.overrideTtlMinutes ?? 60,
    justifications,
    pinThrottle: new OverridePinThrottle()
  });
  const recordsService = new RecordsService({
    db: options.db,
    source: new SqliteRecordSource(options.db),
    crypto: masterKey === null ? null : new FieldCrypto(masterKey),
    clock: options.clock,
    timeZone: options.timeZone,
    shiftGraceMinutes,
    overrides: overrideService
  });

  const app = express();
  app.use(securityHeaders());
  app.use(express.json());
  app.use(cookieParser());

  app.use((req, res, next) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    (req as { requestId?: string }).requestId = requestId;
    next();
  });

  app.use('/api/health', createHealthRouter({
    db: options.db,
    migrationsDir: authConfig.migrationsDir ?? null,
    masterKeyLoaded: authConfig.masterKeyLoaded ?? true
  }));

  app.use(
    '/api/auth',
    createAuthRouter({
      service: authService,
      authenticator,
      demoMode: authConfig.demoMode ?? false
    })
  );

  app.use(
    '/api/audit',
    createAuditRouter({
      db: options.db,
      clock: options.clock,
      timeZone: options.timeZone,
      anchorConfig: options.anchorConfig ?? null,
      authenticator,
      service: recordsService
    })
  );

  app.use('/api/patients', createPatientsRouter({ service: recordsService, authenticator }));
  app.use('/api/handover', createHandoverRouter({ service: recordsService, authenticator }));
  app.use('/api/admissions', createAdmissionsRouter({ service: recordsService, authenticator }));
  app.use('/api/override', createOverrideRouter({ service: overrideService, authenticator }));

  app.use((_req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Unknown endpoint',
        reason_code: null,
        details: {},
        request_id: res.getHeader('X-Request-Id')
      }
    });
  });

  // One error middleware for the whole API. It must be registered last.
  app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const requestId =
      (req as { requestId?: string }).requestId ?? (res.getHeader('X-Request-Id') as string) ?? 'unknown';
    if (error instanceof AppError) {
      res.status(error.httpStatus).json(toErrorBody(error, requestId));
      return;
    }
    res.status(500).json(
      toErrorBody(
        new AppError({ code: 'INTERNAL', httpStatus: 500, message: 'Internal server error' }),
        requestId
      )
    );
  });

  return app;
}
