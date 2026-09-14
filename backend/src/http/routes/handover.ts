// GridVault handover and admissions routes (PRD 12.3).
//
// GET /api/handover?ward= — SBAR sheets for the caller's own ward, watermarked.
// GET /api/admissions/queue — the clerk's intake queue (admin/CMO see all open).

import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import type { RecordsService } from '../../records/service.js';

export interface WardRouterOptions {
  service: RecordsService;
  authenticator: ReturnType<typeof requireAuth>;
}

const handoverQuerySchema = z.object({
  ward: z.string().min(1).max(64),
  terminal_id: z.string().min(1).max(128).optional()
});

export function createHandoverRouter(options: WardRouterOptions): Router {
  const router = Router();

  router.get('/', options.authenticator, (req, res, next) => {
    const parsed = handoverQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      next(new AppError({ code: 'INVALID_BODY', httpStatus: 400, message: 'A ward is required' }));
      return;
    }
    try {
      const authed = req as AuthedRequest;
      const ip = typeof req.ip === 'string' && req.ip.length > 0 ? req.ip : null;
      res
        .status(200)
        .json(
          options.service.handover(authed.auth, parsed.data.ward, {
            terminal_id: parsed.data.terminal_id ?? null,
            source_ip: ip
          })
        );
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function createAdmissionsRouter(options: WardRouterOptions): Router {
  const router = Router();

  router.get('/queue', options.authenticator, (req, res, next) => {
    try {
      const authed = req as AuthedRequest;
      res.status(200).json({ data: options.service.admissionQueue(authed.auth).data });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
