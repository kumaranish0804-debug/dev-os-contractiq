import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { xhrPost, XhrNetworkError } from '@/lib/api/xhr';

/** Scriptable XMLHttpRequest: each test drives the instance's events. */
class FakeXhr {
  static last: FakeXhr;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  sent: unknown = undefined;
  status = 0;
  responseText = '';
  aborted = false;
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(body: unknown) {
    this.sent = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  respond(status: number, text: string) {
    this.status = status;
    this.responseText = text;
    this.onload?.();
  }
}

beforeEach(() => vi.stubGlobal('XMLHttpRequest', FakeXhr));
afterEach(() => vi.unstubAllGlobals());

describe('xhrPost', () => {
  it('posts the form with headers, reports progress and resolves with any status', async () => {
    const progress: number[] = [];
    const form = new FormData();
    const pending = xhrPost('https://fn/upload', form, {
      headers: { authorization: 'Bearer t' },
      onUploadProgress: (f) => progress.push(f),
    });
    const xhr = FakeXhr.last;
    expect([xhr.method, xhr.url, xhr.headers, xhr.sent]).toEqual(['POST', 'https://fn/upload', { authorization: 'Bearer t' }, form]);

    xhr.upload.onprogress!({ lengthComputable: true, loaded: 25, total: 100 });
    xhr.upload.onprogress!({ lengthComputable: false, loaded: 50, total: 0 });
    xhr.upload.onprogress!({ lengthComputable: true, loaded: 100, total: 100 });
    expect(progress).toEqual([0.25, 1]);

    xhr.respond(422, '{"error":{"code":"SCANNED_PDF"}}');
    await expect(pending).resolves.toEqual({ status: 422, body: { error: { code: 'SCANNED_PDF' } } });
  });

  it('yields a null body for empty or non-JSON responses', async () => {
    const empty = xhrPost('u', new FormData());
    FakeXhr.last.respond(204, '');
    await expect(empty).resolves.toEqual({ status: 204, body: null });

    const html = xhrPost('u', new FormData());
    FakeXhr.last.respond(502, '<html>Bad gateway</html>');
    await expect(html).resolves.toEqual({ status: 502, body: null });
  });

  it('rejects with XhrNetworkError on network failure', async () => {
    const pending = xhrPost('u', new FormData());
    FakeXhr.last.onerror!();
    await expect(pending).rejects.toBeInstanceOf(XhrNetworkError);
  });

  it('aborts the request when the signal fires, and refuses an already-aborted signal', async () => {
    const controller = new AbortController();
    const pending = xhrPost('u', new FormData(), { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeXhr.last.aborted).toBe(true);

    const pre = new AbortController();
    pre.abort();
    const refused = xhrPost('u', new FormData(), { signal: pre.signal });
    await expect(refused).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeXhr.last.sent).toBeUndefined();
  });
});
