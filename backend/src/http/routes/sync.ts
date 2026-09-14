// GridVault sync HTTP surface (PRD 10.5, 12.6).
//
// POST /api/sync/batch    offline replay, idempotent, transactional.
// POST /api/sync/backfill paper-slip batch entry (dual timestamps +
//   transcriber attribution, source=paper_backfill).
// GET  /api/sync/status?device_id=  server view of a device's last sequence.

import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import type { RequestMeta } from '../../auth/service.js';
import { SyncService, type SyncMutationInput } from '../../sync/service.js';

export interface SyncRouterOptions {
  service: SyncService;
  authenticator: ReturnType<typeof requireAuth>;
}

const mutationSchema = z.object({
  client_mutation_id: z.string().min(1).max(64),
  device_id: z.string().min(1).max(64),
  device_seq: z.number().int().min(0),
  type: z.enum(['VITALS', 'NOTE_APPEND', 'MAR_SIGN', 'PATIENT_PATCH', 'PAPER_BACKFILL']),
  patient_id: z.string().min(1).max(64),
  base_version: z.number().int().min(1).nullable().optional(),
  payload: z.record(z.unknown()),
  captured_at: z.string().min(1).max(64),
  captured_at_source: z.enum(['device_clock', 'user_entered']).optional()
});

const batchSchema = z.object({
  mutations: mutationSchema.array().min(1).max(100)
});

const backfillSlipSchema = z.object({
  client_mutation_id: z.string().min(1).max(64),
  device_id: z.string().min(1).max(64).default('paper'),
  device_seq: z.number().int().min(0).default(0),
  patient_id: z.string().min(1).max(64),
  payload: z.record(z.unknown()),
  captured_at: z.string().min(1).max(64)
});

const backfillSchema = z.object({
  slips: backfillSlipSchema.array().min(1).max(100)
});

function metaOf(req: AuthedRequest): RequestMeta {
  const ip = typeof req.ip === 'string' && req.ip.length > 0 ? req.ip : null;
  return { terminal_id: null, source_ip: ip };
}

export function createSyncRouter(options: SyncRouterOptions): Router {
  const router = Router();
  const { service, authenticator } = options;

  router.post('/batch', authenticator, (req, res, next) => {
    const parsed = batchSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new AppError({ code: 'INVALID_BODY', httpStatus: 400, message: 'The sync batch is malformed' }));
      return;
    }
    try {
      const authed = req as AuthedRequest;
      const mutations = parsed.data.mutations.map(
        (m): SyncMutationInput => ({
          client_mutation_id: m.client_mutation_id,
          device_id: m.device_id,
          device_seq: m.device_seq,
          type: m.type,
          patient_id: m.patient_id,
          base_version: m.base_version ?? null,
          payload: m.payload as Record<string, unknown>,
          captured_at: m.captured_at,
          captured_at_source: m.captured_at_source
        })
      );
      const result = service.applyBatch(authed.auth, mutations, metaOf(authed));
      res.status(200).json({ data: result });
    } catch (error) {
      next(error);
    }
  });

  // Paper backfill (PRD 10.1/10.5, T3): charge nurse, doctor, nurse, admin or
  // CMO transcribes triage slips. Each slip records the original bedside time
  // AND the entry time, marks source=paper_backfill, names the transcriber
  // and signs a BACKFILL_PAPER_SLIP chain entry. Clerks cannot backfill.
  router.post('/backfill', authenticator, (req, res, next) => {
    const parsed = backfillSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new AppError({ code: 'INVALID_BODY', httpStatus: 400, message: 'The backfill batch is malformed' }));
      return;
    }
    try {
      const authed = req as AuthedRequest;
      if (authed.auth.user.role === 'clerk') {
        throw new AppError({
          code: 'ACCESS_DENIED',
          httpStatus: 403,
          message: 'Only clinical staff can transcribe paper slips',
          reasonCode: 'CLERK_NO_CLINICAL'
        });
      }
      const mutations = parsed.data.slips.map(
        (slip, index): SyncMutationInput => ({
          client_mutation_id: slip.client_mutation_id,
          device_id: slip.device_id,
          device_seq: slip.device_seq !== 0 ? slip.device_seq : index + 1,
          type: 'PAPER_BACKFILL',
          patient_id: slip.patient_id,
          base_version: null,
          payload: slip.payload as Record<string, unknown>,
          captured_at: slip.captured_at,
          captured_at_source: 'user_entered'
        })
      );
      const result = service.applyBatch(authed.auth, mutations, metaOf(authed));
      res.status(201).json({ data: result });
    } catch (error) {
      next(error);
    }
  });

  router.get('/status', authenticator, (req, res, next) => {
    const deviceId = typeof req.query.device_id === 'string' ? req.query.device_id : null;
    if (deviceId === null || deviceId.length === 0) {
      next(new AppError({ code: 'INVALID_BODY', httpStatus: 400, message: 'device_id is required' }));
      return;
    }
    try {
      res.status(200).json({ data: service.deviceStatus(deviceId) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
