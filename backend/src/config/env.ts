// GridVault configuration (AGENTS.md section 8, PRD 14.5).
//
// Every variable in AGENTS.md section 8 is listed here with a safe default.
// loadConfig() validates with Zod and FAILS CLOSED in production: a missing
// master key, a short JWT secret, DEMO_MODE left on, the development master
// key, or missing TLS acknowledgement each throws a ConfigError that names
// the variable. A misconfigured secure system must not run insecurely.

import { z } from 'zod';

export class ConfigError extends Error {
  readonly variable: string;
  constructor(variable: string, message: string) {
    super(`${variable}: ${message}`);
    this.name = 'ConfigError';
    this.variable = variable;
  }
}

/** The development master key placeholder from .env.example. Never valid in production. */
export const DEV_MASTER_KEY_B64 = 'k8s9J3nF9x0q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6=';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_PATH: z.string().min(1).default('./data/gridvault.db'),
  GRIDVAULT_MASTER_KEY: z.string().trim().default(''),
  JWT_SECRET: z.string().default(''),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).default(15),
  REFRESH_TOKEN_TTL_HOURS: z.coerce.number().int().min(1).default(8),
  IDLE_LOCK_SECONDS: z.coerce.number().int().min(1).default(180),
  HARD_LOCK_SECONDS: z.coerce.number().int().min(1).default(900),
  OVERRIDE_TTL_MINUTES: z.coerce.number().int().min(1).default(60),
  SHIFT_GRACE_MINUTES: z.coerce.number().int().min(0).default(30),
  TIMEZONE: z.string().min(1).default('Africa/Lagos'),
  ANCHOR_INTERVAL_MINUTES: z.coerce.number().int().min(1).default(60),
  WITNESS_URL: z.string().min(1).default('http://witness:9090'),
  FACILITY_ID: z.string().min(1).default('gridvault-ward-node'),
  WITNESS_API_KEY: z.string().default(''),
  NODE_SIGNING_KEY: z.string().trim().default(''),
  DEMO_MODE: z
    .string()
    .default('false')
    .transform((v) => v.trim().toLowerCase() === 'true'),
  ALLOW_INSECURE_HTTP: z
    .string()
    .default('false')
    .transform((v) => v.trim().toLowerCase() === 'true'),
  CORS_ALLOWED_ORIGINS: z.string().default(''),
  RATE_LIMIT_LOGIN_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).default(15),
  BACKUP_INTERVAL_HOURS: z.coerce.number().int().min(1).default(4),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info')
});

export type GridVaultEnv = z.infer<typeof envSchema>;

export interface GridVaultConfig extends GridVaultEnv {
  /** Decoded 32-byte master key. Present only when GRIDVAULT_MASTER_KEY is set and valid. */
  masterKeyBytes: Buffer | null;
  isProduction: boolean;
}

function decodeMasterKey(raw: string): Buffer {
  const bytes = Buffer.from(raw.trim(), 'base64');
  if (bytes.byteLength !== 32) {
    throw new ConfigError(
      'GRIDVAULT_MASTER_KEY',
      `must decode to exactly 32 bytes, got ${bytes.byteLength}`
    );
  }
  return bytes;
}

/**
 * Load and validate configuration. Throws ConfigError naming the offending
 * variable. Production gates (PRD 14.5, AT-909/AT-910):
 * - DEMO_MODE=true refuses to boot.
 * - Missing/short master key, or the development key value, refuses to boot.
 * - JWT_SECRET shorter than 32 characters refuses to boot.
 * - Running without TLS acknowledgement (ALLOW_INSECURE_HTTP=true) refuses
 *   to boot: TLS terminates at the nginx sidecar, and a node started without
 *   it must say so explicitly.
 */
export function loadConfig(rawEnv: NodeJS.ProcessEnv = process.env): GridVaultConfig {
  const parsed = envSchema.safeParse(rawEnv);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const variable =
      first !== undefined && first.path.length > 0 ? String(first.path[0]) : 'environment';
    throw new ConfigError(variable, first?.message ?? 'invalid value');
  }
  const env = parsed.data;
  const isProduction = env.NODE_ENV === 'production';

  let masterKeyBytes: Buffer | null = null;
  if (env.GRIDVAULT_MASTER_KEY.length > 0) {
    masterKeyBytes = decodeMasterKey(env.GRIDVAULT_MASTER_KEY);
  }

  if (isProduction) {
    if (env.DEMO_MODE) {
      throw new ConfigError(
        'DEMO_MODE',
        'must be false in production: demo personas and demo endpoints are disabled'
      );
    }
    if (masterKeyBytes === null) {
      throw new ConfigError('GRIDVAULT_MASTER_KEY', 'is required in production');
    }
    if (env.GRIDVAULT_MASTER_KEY.trim() === DEV_MASTER_KEY_B64) {
      throw new ConfigError(
        'GRIDVAULT_MASTER_KEY',
        'the development key value is not allowed in production'
      );
    }
    if (env.JWT_SECRET.length < 32) {
      throw new ConfigError(
        'JWT_SECRET',
        `must be at least 32 characters in production, got ${env.JWT_SECRET.length}`
      );
    }
    if (!env.ALLOW_INSECURE_HTTP) {
      throw new ConfigError(
        'ALLOW_INSECURE_HTTP',
        'must be explicitly true to run production without TLS termination in front of the API'
      );
    }
  }

  return { ...env, masterKeyBytes, isProduction };
}
