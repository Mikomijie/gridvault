import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { URL } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('service-worker API isolation behind a same-origin proxy', () => {
  it('never intercepts API responses, including authenticated patient GETs', () => {
    const handlers: Record<string, (event: unknown) => void> = {};
    runInNewContext(readFileSync('frontend/public/sw.js', 'utf8'), {
      URL,
      self: {
        location: { origin: 'https://demo.example' },
        addEventListener: (name: string, handler: (event: unknown) => void) => { handlers[name] = handler; }
      }
    });
    for (const pathname of ['/api', '/api/patients', '/api/auth/me', '/api/audit/stream', '/private']) {
      let intercepted = false;
      handlers.fetch({
        request: { method: 'GET', url: `https://demo.example${pathname}`, mode: 'cors' },
        respondWith: () => { intercepted = true; }
      });
      expect(intercepted, pathname).toBe(false);
    }
  });
});
