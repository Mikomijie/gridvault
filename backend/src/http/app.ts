// GridVault Express application factory.
//
// createApp(db, ...) builds the full API surface over an explicit database
// handle so tests can mount the app on an isolated :memory: database with
// supertest while production boots it over the file database in index.ts.
// Exactly one error middleware terminates the chain: AppErrors serialize to
// the PRD 12.1 error shape, and anything else becomes a generic 500 that
// leaks neither internals nor PHI.

import express from 'express';
import { randomUUID } from 'node:crypto';
import type { GridVaultDatabase } from '../db/connection.js';
import type { Clock } from '../clock.js';
import type { AnchorServiceConfig } from '../ledger/anchor.js';
import { createAuditRouter } from './routes/audit.js';
import { AppError, toErrorBody } from './errors.js';

export interface CreateAppOptions {
  db: GridVaultDatabase;
  clock?: Clock;
  timeZone?: string;
  anchorConfig?: AnchorServiceConfig | null;
}

export function createApp(options: CreateAppOptions): express.Express {
  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    (req as { requestId?: string }).requestId = requestId;
    next();
  });

  // Unauthenticated liveness, no body. The heartbeat polls this.
  app.get('/api/health/ping', (_req, res) => {
    res.status(200).end();
  });

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
