import { describe, expect, it } from 'vitest';
import { ConfigError, DEV_MASTER_KEY_B64, loadConfig } from '../../src/config/env.js';

const PROD_KEY = Buffer.alloc(32, 7).toString('base64');

function prodEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    GRIDVAULT_MASTER_KEY: PROD_KEY,
    JWT_SECRET: 'a-production-jwt-secret-that-is-long-enough!!',
    ALLOW_INSECURE_HTTP: 'true',
    ...overrides
  };
}

describe('production configuration gates (PRD 14.5)', () => {
  it('requires explicit public-demo acknowledgement before enabling production personas', () => {
    expect(loadConfig(prodEnv({ DEMO_MODE: 'true', PUBLIC_DEMO: 'true' })).PUBLIC_DEMO).toBe(true);
    expect(() => loadConfig(prodEnv({ PUBLIC_DEMO: 'true' }))).toThrow(/PUBLIC_DEMO/);
    expect(() => loadConfig(prodEnv({ DEMO_MODE: 'true', PUBLIC_DEMO: 'true', JWT_SECRET: 'short' }))).toThrow(/JWT_SECRET/);
    expect(() => loadConfig(prodEnv({ DEMO_MODE: 'true', PUBLIC_DEMO: 'true', GRIDVAULT_MASTER_KEY: DEV_MASTER_KEY_B64 }))).toThrow(/development key/);
  });
  it('AT-909: refuses to boot in production with DEMO_MODE=true, naming the variable', () => {
    let error: unknown;
    try {
      loadConfig(prodEnv({ DEMO_MODE: 'true' }));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).variable).toBe('DEMO_MODE');
  });

  it('AT-910: refuses the development master key in production, with a distinct message', () => {
    let error: unknown;
    try {
      loadConfig(prodEnv({ GRIDVAULT_MASTER_KEY: DEV_MASTER_KEY_B64 }));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).variable).toBe('GRIDVAULT_MASTER_KEY');
    expect((error as Error).message).toMatch(/development key/);
  });

  it('AT-910: refuses a short JWT_SECRET in production, with a distinct message', () => {
    let error: unknown;
    try {
      loadConfig(prodEnv({ JWT_SECRET: 'too-short' }));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).variable).toBe('JWT_SECRET');
  });

  it('AT-910: refuses production without TLS acknowledgement, with a distinct message', () => {
    let error: unknown;
    try {
      loadConfig(prodEnv({ ALLOW_INSECURE_HTTP: 'false' }));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).variable).toBe('ALLOW_INSECURE_HTTP');
  });

  it('accepts a fully-specified production environment', () => {
    const config = loadConfig(prodEnv());
    expect(config.isProduction).toBe(true);
    expect(config.masterKeyBytes?.byteLength).toBe(32);
  });
});
