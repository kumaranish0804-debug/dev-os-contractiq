// XMLHttpRequest POST — used instead of fetch where upload progress is needed (Spec 05 §5.8).

export type XhrResult = { status: number; body: unknown };

export class XhrNetworkError extends Error {
  constructor() {
    super('Network request failed');
    this.name = 'XhrNetworkError';
  }
}

/**
 * Resolves with any HTTP status (callers interpret errors). Rejects with XhrNetworkError on
 * network failure, or a DOMException named AbortError when `signal` aborts.
 */
export function xhrPost(
  url: string,
  body: FormData,
  options: {
    headers?: Record<string, string>;
    onUploadProgress?: (fraction: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<XhrResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    for (const [key, value] of Object.entries(options.headers ?? {})) {
      xhr.setRequestHeader(key, value);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        options.onUploadProgress?.(event.loaded / event.total);
      }
    };
    xhr.onload = () => {
      let parsed: unknown = null;
      try {
        parsed = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        parsed = null;
      }
      resolve({ status: xhr.status, body: parsed });
    };
    xhr.onerror = () => reject(new XhrNetworkError());
    xhr.onabort = () => reject(new DOMException('Upload aborted', 'AbortError'));

    if (options.signal) {
      if (options.signal.aborted) {
        reject(new DOMException('Upload aborted', 'AbortError'));
        return;
      }
      options.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(body);
  });
}
