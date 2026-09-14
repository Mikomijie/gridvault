// GridVault audit HTTP surface (PRD 12.5).
//
// Route handler discipline (AGENTS.md section 5): parse input, call a
// service, serialize the result. No SQL, no policy decision, no hash
// computation here — the ledger services own all of that, which is also
// what the no-repository-imports-in-routes lint rule enforces.
//
// Authentication arrives in P3. Until then these endpoints are
// unauthenticated by construction, which DECISIONS.md records; the audit
// surface is read-mostly plus a local anchor trigger, and there is still
// no endpoint anywhere that mutates the ledger.

import { Router } from 'express';
import { z } from 'zod';
import type { GridVaultDatabase } from '../../db/connection.js';
import type { Clock } from '../../clock.js';
import { verifyLedger } from '../../ledger/verify.js';
import {
  AnchorError,
  anchorLedger,
  getAnchorHistory,
  type AnchorServiceConfig
} from '../../ledger/anchor.js';
import { iterateExportLines } from '../../ledger/export.js';
import { AppError } from '../errors.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import type { RecordsService } from '../../records/service.js';

export interface AuditRouterOptions {
  db: GridVaultDatabase;
  clock?: Clock;
  timeZone?: string;
  /** Absent when the node has no signing key configured: anchor execution answers 503. */
  anchorConfig?: AnchorServiceConfig | null;
  /** Absent only in bare ledger-only test apps; /logs answers 404 there. */
  authenticator?: ReturnType<typeof requireAuth>;
  service?: RecordsService;
}

const logsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  staff_id: z.string().min(1).max(64).optional(),
  patient_id: z.string().min(1).max(128).optional(),
  action: z.string().min(1).max(64).optional()
});

export function createAuditRouter(options: AuditRouterOptions): Router {
  const router = Router();

  // PRD 8.5 response, verbatim shape. Streams the ledger; safe on large chains.
  router.get('/verify', (_req, res) => {
    res.json(verifyLedger(options.db));
  });

  // Ledger inspection (PRD 12.5): admin/CMO read everything, doctors read
  // own-ward events, nurses and clerks get 403 (AT-107..109).
  const logsHandler = (req: AuthedRequest, res: { status: (code: number) => { json: (body: unknown) => void } }, next: (error: unknown) => void): void => {
    if (options.service === undefined) {
      next(new AppError({ code: 'NOT_FOUND', httpStatus: 404, message: 'Unknown endpoint' }));
      return;
    }
    const parsed = logsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      next(new AppError({ code: 'INVALID_BODY', httpStatus: 400, message: 'The query is malformed' }));
      return;
    }
    try {
      res.status(200).json(options.service.ledgerLogs(req.auth, parsed.data));
    } catch (error) {
      next(error);
    }
  };
  if (options.authenticator !== undefined) {
    router.get('/logs', options.authenticator, (req, res, next) => {
      logsHandler(req as AuthedRequest, res, next);
    });
  } else {
    router.get('/logs', (req, res, next) => {
      logsHandler(req as AuthedRequest, res, next);
    });
  }

  router.get('/anchors', (_req, res) => {
    res.json(getAnchorHistory(options.db));
  });

  // Force an anchor now (PRD 12.5). 201 when the witness acknowledged,
  // 202 when the receipt was recorded but the witness is lagging — the
  // anchor still happened locally, so this is not an error.
  router.post('/anchor', (_req, res, next) => {
    const config = options.anchorConfig ?? null;
    if (config === null) {
      next(
        new AppError({
          code: 'ANCHOR_NOT_CONFIGURED',
          httpStatus: 503,
          message: 'Anchor signing is not configured on this node'
        })
      );
      return;
    }
    anchorLedger(options.db, config, { clock: options.clock, timeZone: options.timeZone })
      .then((result) => {
        res.status(result.status === 'ACKNOWLEDGED' ? 201 : 202).json(result);
      })
      .catch((error: unknown) => {
        if (error instanceof AnchorError) {
          next(
            new AppError({
              code: 'ANCHOR_FAILED',
              httpStatus: 409,
              message: 'The anchor could not be created',
              details: { reason: error.message }
            })
          );
          return;
        }
        next(error);
      });
  });

  // Signed export for offline verification (PRD 8.7). Only JSONL exists.
  router.get('/export', (req, res, next) => {
    const format = typeof req.query.format === 'string' ? req.query.format : 'jsonl';
    if (format !== 'jsonl') {
      next(
        new AppError({
          code: 'UNSUPPORTED_FORMAT',
          httpStatus: 400,
          message: 'Only format=jsonl is supported for ledger export'
        })
      );
      return;
    }
    res.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
    for (const line of iterateExportLines(options.db)) {
      res.write(line);
    }
    res.end();
  });

  return router;
}
