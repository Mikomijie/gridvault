// GridVault security headers (PRD 14.2, AT-907).
//
// Applied to every response, including errors and 404s: HSTS, a strict CSP
// without unsafe-inline, DENY framing, nosniff, no-referrer and a locked
// Permissions-Policy. CORS default-denies: no Access-Control-Allow-Origin
// is emitted unless an explicit allow-list is configured.

export interface SecurityHeadersOptions {
  allowedOrigins?: string[];
}

const BASE_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; object-src 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

export function securityHeaders(options: SecurityHeadersOptions = {}) {
  const allowed = new Set(options.allowedOrigins ?? []);
  return (
    req: { headers: { origin?: string } },
    res: {
      setHeader: (name: string, value: string) => void;
    },
    next: () => void
  ): void => {
    for (const [name, value] of Object.entries(BASE_HEADERS)) {
      res.setHeader(name, value);
    }
    const origin = req.headers.origin;
    if (origin !== undefined && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    next();
  };
}
