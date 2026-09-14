// GridVault health surface (PRD 12.6).
//
// GET /api/health/ping    unauthenticated liveness, no body (heartbeat).
// GET /api/health/ready   200 when the node can serve: migrations current,
//                         master key loaded, chain head readable. Otherwise
//                         503 with a machine reason (AT-911).
// GET /api/health/metrics Prometheus text format (PRD 14.7). Counters are
//                         best-effort in-process; the endpoint always exists.

import { Router } from 'express';
import type { GridVaultDatabase } from '../../db/connection.js';
import { pendingMigrations } from '../../db/migrate.js';
import { renderMetrics } from '../../observability/metrics.js';
import { AppError } from '../errors.js';

export interface HealthRouterOptions {
  db: GridVaultDatabase;
  migrationsDir: string | null;
  masterKeyLoaded: boolean;
}

export interface ReadinessDetail {
  migrations: 'current' | 'pending';
  master_key: 'loaded' | 'missing';
  chain_head: 'readable' | 'unreadable';
}

function checkReadiness(options: HealthRouterOptions): {
  ready: boolean;
  reason: string | null;
  detail: ReadinessDetail;
} {
  const detail: ReadinessDetail = {
    migrations: 'current',
    master_key: options.masterKeyLoaded ? 'loaded' : 'missing',
    chain_head: 'readable'
  };
  if (!options.masterKeyLoaded) {
    return { ready: false, reason: 'KEY_UNLOADED', detail };
  }
  if (options.migrationsDir !== null) {
    let pending: number[];
    try {
      pending = pendingMigrations(options.db, options.migrationsDir);
    } catch {
      return { ready: false, reason: 'MIGRATIONS_UNKNOWN', detail };
    }
    if (pending.length > 0) {
      detail.migrations = 'pending';
      return { ready: false, reason: 'MIGRATIONS_PENDING', detail };
    }
  }
  try {
    options.db.prepare('SELECT log_index FROM audit_logs ORDER BY log_index DESC LIMIT 1').get();
  } catch {
    detail.chain_head = 'unreadable';
    return { ready: false, reason: 'CHAIN_UNREADABLE', detail };
  }
  return { ready: true, reason: null, detail };
}

export function createHealthRouter(options: HealthRouterOptions): Router {
  const router = Router();

  router.get('/ping', (_req, res) => {
    res.status(200).end();
  });

  router.get('/ready', (_req, res, next) => {
    const check = checkReadiness(options);
    if (check.ready) {
      res.status(200).json({ data: { ready: true, detail: check.detail } });
      return;
    }
    next(
      new AppError({
        code: 'NOT_READY',
        httpStatus: 503,
        message: 'The node is not ready to serve clinical traffic',
        details: { reason: check.reason ?? 'UNKNOWN' }
      })
    );
  });

  router.get('/metrics', (_req, res) => {
    res.setHeader('content-type', 'text/plain; version=0.0.4; charset=utf-8');
    let pendingOutbox = 0;
    try {
      const row = options.db
        .prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE status = 'PENDING'")
        .get() as { n: number };
      pendingOutbox = row.n;
    } catch {
      pendingOutbox = 0;
    }
    let anchorLag: number | null = null;
    try {
      const row = options.db
        .prepare('SELECT MAX(anchored_at) AS m FROM chain_anchors')
        .get() as { m: string | null };
      if (row.m !== null) {
        anchorLag = Math.max(0, (Date.now() - Date.parse(row.m)) / 60000);
      }
    } catch {
      anchorLag = null;
    }
    res.status(200).send(renderMetrics({ pendingOutbox, anchorLagMinutes: anchorLag }));
  });

  return router;
}
