// GridVault records routes (PRD 12.3).
//
// Handler discipline: parse (Zod) -> call the RecordsService -> serialize.
// No SQL, no policy decision, no decryption here. Vitals range schemas are
// deliberately loose (numbers, not ranges): clinical validity has ONE
// server message, produced by the service (422 INVALID_VITALS), so the
// client can mirror it exactly.

import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import type { RecordsService } from '../../records/service.js';
import type { RequestMeta } from '../../auth/service.js';

export interface PatientsRouterOptions {
  service: RecordsService;
  authenticator: ReturnType<typeof requireAuth>;
}

const rosterQuerySchema = z.object({
  ward: z.string().min(1).max(64).optional(),
  status: z.enum(['stable', 'observation', 'critical', 'discharged']).optional(),
  search: z.string().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
});

const vitalsQuerySchema = z.object({
  since: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});

const vitalsBodySchema = z.object({
  heart_rate: z.number(),
  blood_pressure: z.string().min(1).max(16),
  spo2: z.number(),
  temperature: z.number(),
  respiratory_rate: z.number().nullable().optional(),
  pain_score: z.number().nullable().optional(),
  recorded_at: z.string().min(1).max(64).nullable().optional(),
  client_mutation_id: z.string().min(1).max(64).nullable().optional()
});

const noteBodySchema = z.object({
  note_type: z.enum(['nursing', 'medical', 'handover', 'psychiatric']),
  body: z.string().min(1).max(8000)
});

const patchBodySchema = z.object({
  version: z.number().int().min(1),
  full_name: z.string().min(1).max(256).optional(),
  age: z.number().int().min(0).max(130).optional(),
  gender: z.enum(['male', 'female']).optional(),
  ward: z.string().min(1).max(64).optional(),
  bed_number: z.string().min(1).max(32).optional(),
  status: z.enum(['stable', 'observation', 'critical', 'discharged']).optional(),
  next_of_kin: z.string().max(256).nullable().optional(),
  contact_phone: z.string().max(64).nullable().optional(),
  address_lga: z.string().max(256).nullable().optional(),
  payer: z.string().max(128).nullable().optional(),
  admission_source: z.string().max(128).nullable().optional(),
  primary_diagnosis: z.string().min(1).max(2000).optional(),
  allergies: z.string().max(2000).nullable().optional(),
  medications_summary: z.string().max(4000).nullable().optional(),
  hiv_status: z.string().min(1).max(500).optional(),
  genotype: z.string().min(1).max(64).optional(),
  pregnancy_status: z.string().max(2000).nullable().optional(),
  mental_health_notes: z.string().max(8000).nullable().optional()
});

function metaOf(req: AuthedRequest): RequestMeta {
  const terminal =
    typeof req.query.terminal_id === 'string'
      ? req.query.terminal_id
      : typeof req.body?.terminal_id === 'string'
        ? (req.body.terminal_id as string)
        : null;
  const ip = typeof req.ip === 'string' && req.ip.length > 0 ? req.ip : null;
  return { terminal_id: terminal, source_ip: ip };
}

function invalidBody(): AppError {
  return new AppError({ code: 'INVALID_BODY', httpStatus: 400, message: 'The request body is malformed' });
}

export function createPatientsRouter(options: PatientsRouterOptions): Router {
  const router = Router();
  const { service, authenticator } = options;

  router.get('/', authenticator, (req, res, next) => {
    const parsed = rosterQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      next(invalidBody());
      return;
    }
    try {
      const authed = req as AuthedRequest;
      const result = service.readRoster(authed.auth, parsed.data, metaOf(authed));
      const limit = parsed.data.limit ?? result.data.length;
      const data = result.data.slice(0, limit);
      res.status(200).json({ data, _meta: { count: data.length } });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', authenticator, (req, res, next) => {
    try {
      const authed = req as AuthedRequest;
      res.status(200).json(service.readDossier(authed.auth, req.params.id as string, metaOf(authed)));
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id/vitals', authenticator, (req, res, next) => {
    const parsed = vitalsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      next(invalidBody());
      return;
    }
    try {
      const authed = req as AuthedRequest;
      res
        .status(200)
        .json(service.readVitals(authed.auth, req.params.id as string, parsed.data, metaOf(authed)));
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/vitals', authenticator, (req, res, next) => {
    const parsed = vitalsBodySchema.safeParse(req.body);
    if (!parsed.success) {
      next(invalidBody());
      return;
    }
    try {
      const authed = req as AuthedRequest;
      res
        .status(201)
        .json(service.writeVitals(authed.auth, req.params.id as string, parsed.data, metaOf(authed)));
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/notes', authenticator, (req, res, next) => {
    const parsed = noteBodySchema.safeParse(req.body);
    if (!parsed.success) {
      next(invalidBody());
      return;
    }
    try {
      const authed = req as AuthedRequest;
      res
        .status(201)
        .json(service.appendNote(authed.auth, req.params.id as string, parsed.data, metaOf(authed)));
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id/mar', authenticator, (req, res, next) => {
    try {
      const authed = req as AuthedRequest;
      res.status(200).json(service.readMar(authed.auth, req.params.id as string, metaOf(authed)));
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/mar/:entry/sign', authenticator, (req, res, next) => {
    try {
      const authed = req as AuthedRequest;
      res
        .status(200)
        .json(
          service.signMar(
            authed.auth,
            req.params.id as string,
            req.params.entry as string,
            metaOf(authed)
          )
        );
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:id', authenticator, (req, res, next) => {
    const parsed = patchBodySchema.safeParse(req.body);
    if (!parsed.success) {
      next(invalidBody());
      return;
    }
    try {
      const authed = req as AuthedRequest;
      res
        .status(200)
        .json(service.patchPatient(authed.auth, req.params.id as string, parsed.data, metaOf(authed)));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
