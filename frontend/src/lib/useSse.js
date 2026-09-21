import { useEffect, useRef } from 'react';
import { BASE_URL, getAccessToken } from './api.js';

/**
 * useSse jepstream reader (P8, AT-402/613). Native EventSource cannot send
 * Authorization headers, so the console streams over fetch with the bearer
 * token and parses SSE frames itself. Reconnects with backoff; the server
 * replays recent rows on connect so nothing is missed across restarts.
 */
export function useSse(path, { onEvent, enabled = true }) {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;
    let attempt = 0;
    let reader = null;

    const connect = async () => {
      const base = BASE_URL;
      try {
        const res = await fetch(`${base}${path}`, {
          headers: getAccessToken() !== null ? { authorization: `Bearer ${getAccessToken()}` } : {},
          credentials: 'include'
        });
        if (!res.ok || res.body === null) throw new Error(`stream ${res.status}`);
        attempt = 0;
        reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done || stopped) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';
          for (const frame of frames) {
            const lines = frame.split('\n').filter((line) => line.startsWith('data:'));
            if (lines.length === 0) continue;
            try {
              const data = JSON.parse(lines.map((line) => line.slice(5).trim()).join('\n'));
              handler.current(data);
            } catch {
              // Incomplete frame: next chunk completes it.
            }
          }
        }
      } catch {
        if (stopped) return;
        attempt += 1;
        setTimeout(() => {
          if (!stopped) connect().catch(() => undefined);
        }, Math.min(1000 * 2 ** attempt, 15000));
      }
    };
    connect().catch(() => undefined);
    return () => {
      stopped = true;
      try {
        reader?.cancel().catch(() => undefined);
      } catch {
        // Reader already closed.
      }
    };
  }, [path, enabled]);
}
