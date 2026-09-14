// GridVault login rate limiting (PRD 6.6).
//
// Two dimensions, both enforced before password verification succeeds:
// - per staff_id: 5 failures per 10 minutes -> 15-minute lockout. Counters
//   live in the users row (failed_attempts/locked_until) so a restart does
//   not clear a lockout.
// - per source IP: 5 failures per 10 minutes. Tracked in memory; a node
//   restart resets IP buckets but never the per-staff lockout above.
//
// Break-glass PIN entry is exempt from the IP dimension (a ward terminal
// must not be bricked by another user's typos) but never from per-staff
// PIN throttling — that exemption is implemented in the override service,
// not here.

export interface RateLimitConfig {
  maxAttempts: number;
  windowMs: number;
  lockoutMs: number;
}

export const LOGIN_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

interface IpBucket {
  failures: number;
  windowStartMs: number;
}

/** Process-local per-IP failure buckets. Deliberately tiny: one ward node. */
export class IpRateLimiter {
  private readonly buckets = new Map<string, IpBucket>();
  private readonly config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  /** True when this IP has exhausted its window and must be told 429. */
  isLocked(ip: string, nowMs: number): boolean {
    const bucket = this.buckets.get(ip);
    if (bucket === undefined) {
      return false;
    }
    if (nowMs - bucket.windowStartMs >= this.config.windowMs) {
      this.buckets.delete(ip);
      return false;
    }
    return bucket.failures >= this.config.maxAttempts;
  }

  recordFailure(ip: string, nowMs: number): void {
    const bucket = this.buckets.get(ip);
    if (bucket === undefined || nowMs - bucket.windowStartMs >= this.config.windowMs) {
      this.buckets.set(ip, { failures: 1, windowStartMs: nowMs });
      return;
    }
    bucket.failures += 1;
  }

  recordSuccess(ip: string): void {
    this.buckets.delete(ip);
  }
}
