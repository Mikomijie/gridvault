// GridVault authentication middleware.
//
// Verifies the HS256 access token, reloads the user row (role, ward, shift
// and status are server-side facts, re-read per request so deactivation and
// logout take effect inside the 15-minute token window), checks the session
// is still live, and attaches the subject for services. Grants are resolved
// later, per request, by the policy/override path — never from the token.

import type { NextFunction, Request, Response } from 'express';
import type { GridVaultDatabase } from '../../db/connection.js';
import { systemClock, type Clock } from '../../clock.js';
import {
  scheduledExtensionsRepository,
  sessionsRepository,
  usersRepository
} from '../../db/repositories/users.js';
import { AppError } from '../errors.js';
import { TokenError, verifyAccessToken } from '../../auth/tokens.js';
import { dutyState } from '../../policy/duty.js';
import type { AuthenticatedSubject } from '../../auth/service.js';

export interface AuthMiddlewareOptions {
  db: GridVaultDatabase;
  jwtSecret: string;
  clock?: Clock;
  timeZone?: string;
  shiftGraceMinutes?: number;
}

export interface AuthedRequest extends Request {
  auth: AuthenticatedSubject;
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header === undefined) {
    return null;
  }
  const match = /^Bearer (.+)$/.exec(header.trim());
  return match === null ? null : (match[1] as string);
}

export function requireAuth(options: AuthMiddlewareOptions) {
  const clock = options.clock ?? systemClock;
  const timeZone = options.timeZone ?? 'Africa/Lagos';
  const graceMinutes = options.shiftGraceMinutes ?? 30;

  return (req: Request, _res: Response, next: NextFunction): void => {
    const raw = bearerToken(req);
    if (raw === null) {
      next(
        new AppError({
          code: 'TOKEN_INVALID',
          httpStatus: 401,
          message: 'Authentication is required'
        })
      );
      return;
    }
    let claims;
    try {
      claims = verifyAccessToken(options.jwtSecret, raw);
    } catch (error) {
      if (error instanceof TokenError && error.code === 'TOKEN_EXPIRED') {
        next(
          new AppError({
            code: 'TOKEN_EXPIRED',
            httpStatus: 401,
            message: 'The access token has expired'
          })
        );
        return;
      }
      next(
        new AppError({ code: 'TOKEN_INVALID', httpStatus: 401, message: 'The access token is invalid' })
      );
      return;
    }

    const user = usersRepository(options.db).findById(claims.sub);
    if (user === undefined || user.staff_id !== claims.staff_id) {
      next(
        new AppError({ code: 'TOKEN_INVALID', httpStatus: 401, message: 'The access token is invalid' })
      );
      return;
    }
    if (user.account_status !== 'active') {
      next(
        new AppError({ code: 'ACCOUNT_INACTIVE', httpStatus: 401, message: 'This account is not active' })
      );
      return;
    }
    if (user.expires_at !== null && Date.parse(user.expires_at) <= clock.now().getTime()) {
      next(
        new AppError({ code: 'ACCOUNT_EXPIRED', httpStatus: 401, message: 'This account has expired' })
      );
      return;
    }
    const session = sessionsRepository(options.db).findById(claims.session_id);
    if (session === undefined || session.revoked_at !== null) {
      next(
        new AppError({
          code: 'SESSION_REVOKED',
          httpStatus: 401,
          message: 'The session is no longer valid. Please log in again.'
        })
      );
      return;
    }

    const now = clock.now();
    const extensions = scheduledExtensionsRepository(options.db).listActiveForUser(
      user.id,
      now.toISOString()
    );
    (req as AuthedRequest).auth = {
      user,
      sessionId: claims.session_id,
      duty: dutyState({
        shift: user.assigned_shift,
        at: now,
        timeZone,
        graceMinutes,
        extensions
      })
    };
    next();
  };
}
