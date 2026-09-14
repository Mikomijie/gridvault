// GridVault Server-Sent Events helper (PRD 9.1, 12.6).
//
// The security console's live alert feed and ledger inspector subscribe to
// these streams. Delivery is DB-backed short-poll: on connect the endpoint
// replays recent rows, then every 500 ms pushes rows newer than the last
// sent id. Polling keeps the stream correct across restarts and power cuts —
// an in-memory emitter would silently drop the events a console most needs
// to see — at the cost of sub-second (not instant) delivery.

import type { Response } from 'express';

export function openSseStream(res: Response, heartbeatMs = 15000): () => boolean {
  res.setHeader('content-type', 'text/event-stream; charset=utf-8');
  res.setHeader('cache-control', 'no-cache, no-transform');
  res.setHeader('connection', 'keep-alive');
  res.setHeader('x-accel-buffering', 'no');
  res.flushHeaders?.();
  let closed = false;
  res.on('close', () => {
    closed = true;
  });
  const heartbeat = setInterval(() => {
    if (closed) {
      clearInterval(heartbeat);
      return;
    }
    try {
      res.write(': heartbeat\n\n');
    } catch {
      closed = true;
      clearInterval(heartbeat);
    }
  }, heartbeatMs);
  if (typeof (heartbeat as unknown as { unref?: () => void }).unref === 'function') {
    (heartbeat as unknown as { unref: () => void }).unref();
  }
  res.on('close', () => {
    clearInterval(heartbeat);
  });
  return () => closed;
}

export function writeSseEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  for (const line of JSON.stringify(data).split('\n')) {
    res.write(`data: ${line}\n`);
  }
  res.write('\n');
}
