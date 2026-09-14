// GridVault tokens (PRD 6.6).
//
// Access: JWT HS256, 15 min, claims sub/staff_id/role/ward/shift/
// session_id/jti/iat/exp/policy_version. Grants are NEVER carried in the
// token — they are looked up server-side per request so revocation is
// immediate (AT-211).
//
// Refresh: opaque 256-bit token in an HttpOnly/Secure/SameSite=Strict
// cookie, 8-hour absolute lifetime, rotated on every use. Only the SHA-256
// of the token is stored (sessions.refresh_hash); a rotated row is kept
// with revoked_reason='rotated' so a replay is detectable as reuse
// (RULE-ABUSE-09) rather than as an unknown token.

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { AssignedShift, UserRole } from '../db/repositories/users.js';

export const POLICY_VERSION = '2.0.0';

export interface AccessTokenClaims {
  sub: string;
  staff_id: string;
  role: UserRole;
  ward: string;
  shift: AssignedShift;
  session_id: string;
  jti: string;
  policy_version: string;
}

export class TokenError extends Error {
  readonly code: 'TOKEN_EXPIRED' | 'TOKEN_INVALID';
  constructor(code: 'TOKEN_EXPIRED' | 'TOKEN_INVALID', message: string) {
    super(message);
    this.name = 'TokenError';
    this.code = code;
  }
}

export function signAccessToken(
  claims: Omit<AccessTokenClaims, 'jti' | 'policy_version'>,
  secret: string,
  ttlMinutes: number
): string {
  const payload: AccessTokenClaims = {
    ...claims,
    jti: randomUUID(),
    policy_version: POLICY_VERSION
  };
  return jwt.sign(payload, secret, {
    algorithm: 'HS256',
    expiresIn: `${ttlMinutes}m`
  });
}

export function verifyAccessToken(secret: string, token: string): AccessTokenClaims {
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as Record<string, unknown>;
    if (
      typeof decoded.sub !== 'string' ||
      typeof decoded.staff_id !== 'string' ||
      typeof decoded.role !== 'string' ||
      typeof decoded.ward !== 'string' ||
      typeof decoded.shift !== 'string' ||
      typeof decoded.session_id !== 'string' ||
      typeof decoded.jti !== 'string'
    ) {
      throw new TokenError('TOKEN_INVALID', 'Access token is missing required claims');
    }
    return {
      sub: decoded.sub,
      staff_id: decoded.staff_id,
      role: decoded.role as UserRole,
      ward: decoded.ward,
      shift: decoded.shift as AssignedShift,
      session_id: decoded.session_id,
      jti: decoded.jti,
      policy_version: typeof decoded.policy_version === 'string' ? decoded.policy_version : ''
    };
  } catch (error) {
    if (error instanceof TokenError) {
      throw error;
    }
    if (error instanceof jwt.TokenExpiredError) {
      throw new TokenError('TOKEN_EXPIRED', 'Access token has expired');
    }
    throw new TokenError('TOKEN_INVALID', 'Access token is invalid');
  }
}

/** A fresh 256-bit opaque refresh token (64 hex chars). */
export function newRefreshToken(): string {
  return randomBytes(32).toString('hex');
}

/** Storage form: SHA-256 hex. The raw token never touches the database. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
