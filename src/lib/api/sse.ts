// Server-Sent Events over fetch (Spec 09 §9.7). EventSource can't POST or send auth headers.

export type SseEvent = { event: string; data: unknown };

/**
 * Yields each `event:`/`data:` block; `:` comment lines (heartbeats) are skipped. Aborting
 * `signal` cancels the reader, so a stop never waits on the network.
 */
export async function* readSse(res: Response, signal?: AbortSignal): AsyncGenerator<SseEvent> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const cancel = () => void reader.cancel().catch(() => {});
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (raw.startsWith(':')) continue;
        const event = /^event: ?(.*)$/m.exec(raw)?.[1] ?? 'message';
        const data = /^data: ?(.*)$/m.exec(raw)?.[1];
        if (data !== undefined) yield { event, data: JSON.parse(data) };
      }
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}
