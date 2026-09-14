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
import type { AnchorServiceConfig } from '../ledger/anchor.js';
import { createAuditRouter } from './routes/audit.js';
import { createAuthRouter } from './routes/auth.js';
import { createHealthRouter } from './routes/health.js';
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
  masterKeyLoaded?: boolean;
  migrationsDir?: string | null;
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
      anchorConfig: options.anchorConfig ?? null
    })
  );

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
