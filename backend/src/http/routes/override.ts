// GridVault break-glass routes (PRD 12.4).
//
// POST /execute performs PIN verify -> grant row -> ledger entries ->
// outbox dispatch rows in one transaction (p95 <= 400 ms server-side).
// Grants are looked up server-side per request and never carried in the
// JWT, so revoke and expiry take effect on the very next request.

import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import type { OverrideService } from '../../override/service.js';
import type { RequestMeta } from '../../auth/service.js';

export interface OverrideRouterOptions {
  service: OverrideService;
  authenticator: ReturnType<typeof requireAuth>;
}

const executeSchema = z.object({
  patient_id: z.string().min(1).max(64),
  justification_code: z.string().min(1).max(64),
  justification_notes: z.string().max(2000).nullable().optional(),
  pin: z.string().min(1).max(32)
});

const revokeSchema = z.object({
  reason: z.string().min(1).max(500).optional()
});

const reviewSchema = z.object({
  decision: z.enum(['acknowledged', 'escalated']),
  notes: z.string().max(2000).optional()
});

const queueQuerySchema = z.object({
  state: z.enum(['ACTIVE', 'EXPIRED', 'CLOSED', 'REVOKED']).optional()
});

function metaOf(req: AuthedRequest): RequestMeta {
  const ip = typeof req.ip === 'string' && req.ip.length > 0 ? req.ip : null;
  return { terminal_id: null, source_ip: ip };
}

export function createOverrideRouter(options: OverrideRouterOptions): Router {
  const router = Router();
  const { service, authenticator } = options;

  router.post('/execute', authenticator, (req, res, next) => {
    const parsed = executeSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new AppError({ code: 'INVALID_BODY', httpStatus: 400, message: 'The override request is malformed' }));
      return;
    }
    const authed = req as AuthedRequest;
    service
      .execute(
        authed.auth,
        {
          patient_id: parsed.data.patient_id,
          justification_code: parsed.data.justification_code,
          justification_notes: parsed.data.justification_notes ?? null,
          pin: parsed.data.pin
        },
        metaOf(authed)
      )
      .then((result) => {
        res.status(201).json({ data: result });
      })
      .catch(next);
  });

  router.get('/active', authenticator, (req, res, next) => {
    try {
      const authed = req as AuthedRequest;
      res.status(200).json({ data: { grants: service.activeFor(authed.auth) } });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/close', authenticator, (req, res, next) => {
    try {
      const authed = req as AuthedRequest;
      service.close(authed.auth, req.params.id as string, metaOf(authed));
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/revoke', authenticator, (req, res, next) => {
    const parsed = revokeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      next(new AppError({ code: 'INVALID_BODY', httpStatus: 400, message: 'The revoke request is malformed' }));
      return;
    }
    try {
      const authed = req as AuthedRequest;
      service.revoke(authed.auth, req.params.id as string, parsed.data.reason, metaOf(authed));
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get('/', authenticator, (req, res, next) => {
    const parsed = queueQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      next(new AppError({ code: 'INVALID_BODY', httpStatus: 400, message: 'The query is malformed' }));
      return;
    }
    try {
      const authed = req as AuthedRequest;
      res.status(200).json({ data: { overrides: service.listQueue(authed.auth, parsed.data.state) } });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/review', authenticator, (req, res, next) => {
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new AppError({ code: 'INVALID_BODY', httpStatus: 400, message: 'The review is malformed' }));
      return;
    }
    try {
      const authed = req as AuthedRequest;
      service.review(
        authed.auth,
        req.params.id as string,
        parsed.data.decision,
        parsed.data.notes,
        metaOf(authed)
      );
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
