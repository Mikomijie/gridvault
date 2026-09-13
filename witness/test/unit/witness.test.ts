import { describe, it, expect } from 'vitest';
import { app } from '../../src/index.js';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

function simulateGet(requestUrl: string): Promise<{ status: number; body: unknown }> {
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
        body: JSON.parse(responseText)
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

describe('Witness Service Health and Status', () => {
  it('GET /health returns 200 OK with service identifier and custody disclosure', async () => {
    const res = await simulateGet('/health');
    expect(res.status).toBe(200);
    // The P2 witness discloses its custody and storage mode alongside the
    // original liveness fields, so operators can see at a glance whether
    // this instance is under real custody or development-only.
    expect(res.body).toEqual({
      status: 'ok',
      service: 'gridvault-witness',
      custody: 'none-development-only',
      storage: 'memory-only',
      anchors: 0
    });
  });
});
