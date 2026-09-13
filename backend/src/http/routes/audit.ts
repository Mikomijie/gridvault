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

export interface AuditRouterOptions {
  db: GridVaultDatabase;
  clock?: Clock;
  timeZone?: string;
  /** Absent when the node has no signing key configured: anchor execution answers 503. */
  anchorConfig?: AnchorServiceConfig | null;
}

export function createAuditRouter(options: AuditRouterOptions): Router {
  const router = Router();

  // PRD 8.5 response, verbatim shape. Streams the ledger; safe on large chains.
  router.get('/verify', (_req, res) => {
    res.json(verifyLedger(options.db));
  });

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
