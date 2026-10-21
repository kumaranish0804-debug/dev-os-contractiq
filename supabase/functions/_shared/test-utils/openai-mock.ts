// Deterministic stand-ins for OpenAI in Deno tests (Spec 12: tests never call real OpenAI).
import type { ChatMessage, Completion, CompleteFn, CompletionOptions, StreamChunk, StreamFn } from '../openai.ts';

export type ExpectedFixture = {
  contract_type: 'NDA' | 'MSA';
  page_count: number;
  terms: Record<string, { value: string | null; page: number | null; source_sentence?: string }>;
};

export const USAGE = { prompt: 4000, cached: 1000, completion: 600 };

/** A successful JSON completion built from tests/fixtures/expected/*.json. */
export function completionFromExpected(
  expected: ExpectedFixture,
  extra: { custom?: Record<string, { value: string; page: number; source_sentence: string }> } = {},
): Completion {
  const terms = [
    ...Object.entries(expected.terms).map(([key, t]) => ({
      term_key: key,
      term_name: key,
      value: t.value,
      page_number: t.page,
      source_sentence: t.source_sentence ?? null,
      confidence_score: t.value ? 0.95 : 0,
    })),
    ...Object.entries(extra.custom ?? {}).map(([key, t]) => ({
      term_key: key,
      term_name: key,
      value: t.value,
      page_number: t.page,
      source_sentence: t.source_sentence,
      confidence_score: 0.85,
    })),
  ];
  return json({ terms, detected_contract_type: expected.contract_type });
}

export const json = (body: unknown, finishReason = 'stop'): Completion => ({
  content: JSON.stringify(body),
  finishReason,
  usage: { ...USAGE },
});

export const raw = (content: string, finishReason = 'stop'): Completion => ({
  content,
  finishReason,
  usage: { ...USAGE },
});

/** An error shaped like the OpenAI SDK's (name + status), as classifyOpenAIError reads them. */
export const apiError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status, name: 'APIError' });
export const timeoutError = () => Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' });

export type Step = Completion | Error;

/** Returns each scripted step in turn (throwing Errors) and records every request. */
export function scriptedComplete(steps: Step[]) {
  const calls: { messages: ChatMessage[]; options: CompletionOptions }[] = [];
  const queue = [...steps];
  const complete: CompleteFn = (messages, options) => {
    calls.push({ messages, options });
    const step = queue.shift();
    if (!step) return Promise.reject(new Error('openai-mock: no scripted response left'));
    return step instanceof Error ? Promise.reject(step) : Promise.resolve(step);
  };
  return { complete, calls };
}

/** One streamed response: text deltas, optionally failing mid-way or never producing a token. */
export type StreamStep =
  | Error // the stream fails to open (retryable or not, by its status)
  | { deltas: string[]; usage?: typeof USAGE; failAfter?: Error }
  | 'hang';

/** Streams each scripted response in turn and records every request. Honours the abort signal. */
export function scriptedStream(steps: StreamStep[]) {
  const calls: { messages: ChatMessage[] }[] = [];
  const queue = [...steps];
  const stream: StreamFn = (messages, _options, signal) => {
    calls.push({ messages });
    const step = queue.shift();
    if (!step) return Promise.reject(new Error('openai-mock: no scripted stream left'));
    if (step instanceof Error) return Promise.reject(step);
    const script: Exclude<StreamStep, Error> = step;

    const aborted = () =>
      new Promise<never>((_, reject) => {
        if (signal.aborted) reject(new DOMException('Aborted', 'AbortError'));
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });

    async function* chunks(): AsyncGenerator<StreamChunk> {
      if (script === 'hang') {
        await aborted();
        return;
      }
      for (const text of script.deltas) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        await Promise.resolve();
        yield { text };
      }
      if (script.failAfter) throw script.failAfter;
      yield { usage: script.usage ?? { ...USAGE } };
    }
    return Promise.resolve(chunks());
  };
  return { stream, calls };
}

/** Parses an SSE response body into events (heartbeat comments are reported as `ping`). */
export async function readSseEvents(res: Response): Promise<{ event: string; data: unknown }[]> {
  const text = await res.text();
  return text
    .split('\n\n')
    .filter((block) => block.trim())
    .map((block) => {
      if (block.startsWith(':')) return { event: 'ping', data: null };
      const event = /^event: (.*)$/m.exec(block)?.[1] ?? 'message';
      const data = /^data: (.*)$/m.exec(block)?.[1];
      return { event, data: data ? JSON.parse(data) : null };
    });
}

export async function loadExpected(name: 'nda-3-pages' | 'msa-6-pages'): Promise<ExpectedFixture> {
  const url = new URL(`../../../../tests/fixtures/expected/${name}.json`, import.meta.url);
  return JSON.parse(await Deno.readTextFile(url));
}

export const fixtureBytes = (name: string) =>
  Deno.readFile(new URL(`../../../../tests/fixtures/${name}`, import.meta.url));
