// GridVault authentication routes (PRD 12.2).
//
// Handler discipline: parse (Zod, unknown keys stripped — a body carrying
// role/ward/shift is ignored, never trusted), call the AuthService,
// serialize. No SQL, no token logic, no policy decision here.
//
// POST /login   {staff_id, password, terminal_id?} -> tokens + refresh cookie
// POST /refresh (cookie) -> rotated pair
// POST /logout  -> 204, session revoked
// POST /lock    -> 204, SESSION_LOCK ledger entry (idle lock is client-driven)
// POST /unlock  {pin} -> fresh access token + SESSION_UNLOCK
// GET  /me      -> user + duty state + active grants
// GET  /personas -> demo personas, DEMO_MODE only

import { Router } from 'express';
import { z } from 'zod';
import { DEMO_PINS, DEMO_STAFF, demoPasswordFor } from '../../db/seed.js';
import { AppError } from '../errors.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { AuthService, REFRESH_COOKIE_NAME } from '../../auth/service.js';

export interface AuthRouterOptions {
  service: AuthService;
  /** Shared with the auth middleware so both sides agree on secrets/clock. */
  authenticator: ReturnType<typeof requireAuth>;
  demoMode: boolean;
}

const loginSchema = z.object({
  staff_id: z.string().min(1).max(64),
  password: z.string().min(1).max(512),
  terminal_id: z.string().min(1).max(64).optional()
});

const unlockSchema = z.object({
  pin: z.string().min(1).max(32)
});

function clientIp(req: AuthedRequest | { ip?: string }): string | null {
  const ip = (req as { ip?: string }).ip;
  return typeof ip === 'string' && ip.length > 0 ? ip : null;
}

export function createAuthRouter(options: AuthRouterOptions): Router {
  const router = Router();
  const { service } = options;

  router.post('/login', (req, res, next) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      next(
        new AppError({
          code: 'INVALID_BODY',
          httpStatus: 400,
          message: 'The login request is malformed'
        })
      );
      return;
    }
    service
      .login({
        staff_id: parsed.data.staff_id,
        password: parsed.data.password,
        terminal_id: parsed.data.terminal_id ?? null,
        source_ip: clientIp(req)
      })
      .then((result) => {
        res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, {
          httpOnly: true,
          secure: true,
          sameSite: 'strict',
          path: '/api/auth',
          maxAge: service.refreshCookieMaxAgeMs()
        });
        res.status(200).json({
          data: {
            access_token: result.accessToken,
            expires_in: result.expiresInSeconds,
            user: result.user
          }
        });
      })
      .catch(next);
  });

  router.post('/refresh', (req, res, next) => {
    const raw =
      req.cookies !== undefined && typeof req.cookies[REFRESH_COOKIE_NAME] === 'string'
        ? (req.cookies[REFRESH_COOKIE_NAME] as string)
        : null;
    if (raw === null) {
      next(
        new AppError({ code: 'INVALID_REFRESH', httpStatus: 401, message: 'Refresh cookie is missing' })
      );
      return;
    }
    service
      .refresh({ refreshToken: raw, source_ip: clientIp(req) })
      .then((result) => {
        res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, {
          httpOnly: true,
          secure: true,
          sameSite: 'strict',
          path: '/api/auth',
          maxAge: service.refreshCookieMaxAgeMs()
        });
        res.status(200).json({
          data: {
            access_token: result.accessToken,
            expires_in: result.expiresInSeconds
          }
        });
      })
      .catch(next);
  });

  router.post('/logout', options.authenticator, (req, res, next) => {
    try {
      const authed = req as AuthedRequest;
      service.logout(authed.auth, { source_ip: clientIp(req) });
      res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post('/lock', options.authenticator, (req, res, next) => {
    try {
      service.recordLock((req as AuthedRequest).auth, { source_ip: clientIp(req) });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post('/unlock', options.authenticator, (req, res, next) => {
    const parsed = unlockSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new AppError({ code: 'INVALID_BODY', httpStatus: 400, message: 'A PIN is required' }));
      return;
    }
    service
      .unlock((req as AuthedRequest).auth, parsed.data.pin, { source_ip: clientIp(req) })
      .then((result) => {
        res.status(200).json({
          data: {
            access_token: result.accessToken,
            expires_in: result.expiresInSeconds
          }
        });
      })
      .catch(next);
  });

  router.get('/me', options.authenticator, (req, res, next) => {
    try {
      res.status(200).json({ data: service.me((req as AuthedRequest).auth) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/personas', (_req, res, next) => {
    if (!options.demoMode) {
      next(
        new AppError({ code: 'NOT_FOUND', httpStatus: 404, message: 'Unknown endpoint' })
      );
      return;
    }
    res.status(200).json({
      data: {
        personas: DEMO_STAFF.map((staff) => ({
          staff_id: staff.staffId,
          full_name: staff.fullName,
          role: staff.role,
          ward: staff.ward,
          shift: staff.shift,
          password: demoPasswordFor(staff.staffId),
          pin: DEMO_PINS[staff.staffId] ?? null
        }))
      }
    });
  });

  return router;
}
