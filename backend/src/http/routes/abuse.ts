// GridVault abuse-detection HTTP surface (PRD 12.6, AGENTS P6).
//
// Handler discipline: parse (Zod) -> service/engine -> serialize.
// No SQL, no policy decision here.
//
// GET  /api/abuse/alerts?status=&severity=&limit=  Alert feed (admin/cmo only).
// PATCH /api/abuse/alerts/:id  {status, resolution?, notes?}  Triage; self-resolution rejected 403 (AT-408).
// GET  /api/abuse/stream  SSE live feed (admin/cmo only).
// POST /api/abuse/demo/clerk-probe  DEMO_MODE only. Performs a genuine
//   authenticated request as RC-1029 against HOSP-LOS-2025-082 through the
//   real RecordsService path — decide() -> deny -> obligations -> alert — and
//   returns the denial + alert. It never inserts a fabricated row (AT-401/402).

import { Router } from 'express';
import { z } from 'zod';
import type { GridVaultDatabase } from '../../db/connection.js';
import type { Clock } from '../../clock.js';
import { systemClock } from '../../clock.js';
import { AppError } from '../errors.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import type { RecordsService } from '../../records/service.js';
import { findUserByStaffId, latestAlertByRule, listAlerts, listAlertsSince, listRecentAlerts, resolveAbuseAlert } from '../../abuse/alerts.js';
import { openSseStream, writeSseEvent } from '../sse.js';

export interface AbuseRouterOptions {
  db: GridVaultDatabase;
  clock?: Clock;
  timeZone?: string;
  authenticator: ReturnType<typeof requireAuth>;
  service: RecordsService;
  demoMode?: boolean;
}

const alertsQuerySchema = z.object({
  status: z.enum(['FLAGGED', 'INVESTIGATING', 'RESOLVED']).optional(),
  severity: z.enum(['CRITICAL', 'WARNING', 'INFO']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
});

const triageSchema = z.object({
  status: z.enum(['INVESTIGATING', 'RESOLVED', 'FLAGGED']),
  resolution: z.enum(['justified', 'confirmed_abuse', 'false_positive']).optional(),
  notes: z.string().max(2000).optional()
});

function guardTriager(role: string): void {
  if (role !== 'admin' && role !== 'cmo') {
    throw new AppError({
      code: 'ACCESS_DENIED',
      httpStatus: 403,
      message: 'Only an administrator or the CMO can triage alerts'
    });
  }
}

export function createAbuseRouter(options: AbuseRouterOptions): Router {
  const router = Router();
  const { db, authenticator, service } = options;
  const clock = options.clock ?? systemClock;
  const timeZone = options.timeZone ?? 'Africa/Lagos';
  const demoMode = options.demoMode ?? false;

  router.get('/alerts', authenticator, (req, res, next) => {
    try {
      const authed = req as AuthedRequest;
      guardTriager(authed.auth.user.role);
      const parsed = alertsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError({ code: 'INVALID_BODY', httpStatus: 400, message: 'The query is malformed' });
      }
      const rows = listAlerts(db, {
        status: parsed.data.status,
        severity: parsed.data.severity,
        limit: parsed.data.limit ?? 50
      });
      res.status(200).json({ data: rows, _meta: { count: rows.length } });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/alerts/:id', authenticator, (req, res, next) => {
    try {
      const authed = req as AuthedRequest;
      const parsed = triageSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError({ code: 'INVALID_BODY', httpStatus: 400, message: 'The triage request is malformed' });
      }
      const updated = resolveAbuseAlert(
        db,
        {
          alert_id: req.params.id as string,
          actor_staff_id: authed.auth.user.staff_id,
          actor_role: authed.auth.user.role,
          actor_ward: authed.auth.user.assigned_ward,
          status: parsed.data.status,
          resolution: parsed.data.resolution,
          notes: parsed.data.notes
        },
        { clock, timeZone, session_id: authed.auth.sessionId }
      );
      res.status(200).json({ data: updated });
    } catch (error) {
      next(error);
    }
  });

  // Live feed: replay recent alerts, then poll every 500 ms for newer rows.
  // Auth is checked once at connect; rows are alert metadata only (no PHI).
  router.get('/stream', authenticator, (req, res) => {
    const authed = req as unknown as AuthedRequest;
    try {
      guardTriager(authed.auth.user.role);
    } catch {
      res.status(403).json({
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied by policy',
          reason_code: 'ADMIN_ONLY',
          details: {},
          request_id: (res.getHeader('X-Request-Id') as string) ?? 'unknown',
          can_break_glass: false
        }
      });
      return;
    }
    const isClosed = openSseStream(res);
    let lastSeen = typeof req.query.since === 'string' ? req.query.since : '1970-01-01T00:00:00.000+00:00';
    // Initial replay: most recent 20 alerts.
    const initial = listRecentAlerts(db, 20);
    for (const row of [...initial].reverse()) {
      writeSseEvent(res, 'alert', row);
      if (row.timestamp > lastSeen) lastSeen = row.timestamp;
    }
    const timer = setInterval(() => {
      if (isClosed()) {
        clearInterval(timer);
        return;
      }
      try {
        const rows = listAlertsSince(db, lastSeen, 50);
        for (const row of rows) {
          writeSseEvent(res, 'alert', row);
          if (row.timestamp > lastSeen) lastSeen = row.timestamp;
        }
      } catch {
        // Poll failure must not kill the stream; next tick retries.
      }
    }, 500);
    timer.unref?.();
    req.on('close', () => clearInterval(timer));
  });

  // Mandatory demonstration (PRD 9.4): a real denial through the real path.
  router.post('/demo/clerk-probe', authenticator, (req, res, next) => {
    if (!demoMode) {
      next(new AppError({ code: 'NOT_FOUND', httpStatus: 404, message: 'Unknown endpoint' }));
      return;
    }
    try {
      const clerk = findUserByStaffId(db, 'RC-1029');
      if (clerk === undefined) {
        throw new AppError({ code: 'INTERNAL', httpStatus: 500, message: 'Demo clerk is not seeded' });
      }
      // Build a server-side subject for the clerk with on_duty forced: the
      // probe proves the clerk-queue control, not the shift roster. Duty is
      // still a server fact here, never a client-supplied value.
      const probeAuth = {
        user: clerk,
        sessionId: `demo-probe-${Date.now()}`,
        duty: 'on_duty' as const
      };
      const meta = {
        terminal_id: 'demo-console',
        source_ip: typeof req.ip === 'string' ? req.ip : null
      };
      let denial: { status: number; reason_code: string | null; decision_id: string | null } | null = null;
      try {
        service.readDossier(probeAuth, 'HOSP-LOS-2025-082', meta);
      } catch (error) {
        if (error instanceof AppError) {
          denial = {
            status: error.httpStatus,
            reason_code: error.reasonCode,
            decision_id: typeof error.details.decision_id === 'string' ? error.details.decision_id : null
          };
        } else {
          throw error;
        }
      }
      if (denial === null) {
        throw new AppError({
          code: 'INTERNAL',
          httpStatus: 500,
          message: 'The demo probe unexpectedly succeeded'
        });
      }
      // The alert must be the product of that decision: join on decision_id.
      const alert = latestAlertByRule(db, 'RULE-ABUSE-01');
      if (alert === undefined) {
        throw new AppError({ code: 'INTERNAL', httpStatus: 500, message: 'The probe produced no alert' });
      }
      res.status(200).json({
        data: {
          denial,
          alert,
          genuine: alert.decision_id !== null && alert.decision_id === denial.decision_id
        }
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
