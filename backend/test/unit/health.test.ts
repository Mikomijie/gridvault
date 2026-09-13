import { describe, it, expect } from 'vitest';
import { app } from '../../src/index.js';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

function simulateGet(requestUrl: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve) => {
    const socket = new Socket();
    const req = new IncomingMessage(socket);
    req.method = 'GET';
    req.url = requestUrl;

    let responseText = '';
    const res = new ServerResponse(req);

    // Justification: patching write to capture in-memory response text without network socket
    res.write = function (chunk: unknown) {
      if (chunk) responseText += String(chunk);
      return true;
    } as any;

    // Justification: patching end to complete in-memory response resolution without network socket
    res.end = function (chunk?: unknown) {
      if (chunk) responseText += String(chunk);
      resolve({
        status: res.statusCode,
        text: responseText
      });
      return res;
    } as any;

    // Justification: Express application exposes internal handle method for in-memory dispatch
    (app as unknown as { handle: (req: IncomingMessage, res: ServerResponse) => void }).handle(
      req,
      res
    );
  });
}

describe('Backend API Health and Liveness', () => {
  it('GET /api/health/ping returns 200 OK with empty body', async () => {
    const res = await simulateGet('/api/health/ping');
    expect(res.status).toBe(200);
    expect(res.text).toBe('');
  });
});
