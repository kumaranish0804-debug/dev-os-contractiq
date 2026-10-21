import OpenAI from 'openai';
import { AppError } from './errors.ts';
import type { ChatMessage, CompleteFn } from './llm.ts';

// Azure AI Foundry agent client (Responses API). Each pipeline has its own agent — chat and
// extraction — whose portal prompt is a thin wrapper: the versioned prompts in prompts/ travel
// inside the single input message (see toAgentInput), so evals keep testing what runs.
//
// The agent owns its configuration: no model, instructions, temperature or token limit is sent
// (the agent rejects overrides with "not allowed when agent is specified").

/** Used only when the portal endpoint carries no ?api-version. Preview versions rotate. */
export const DEFAULT_AZURE_API_VERSION = '2025-11-15-preview';

/** Agent calls routinely take 20–30 s; withRetry's overall budget still caps the request. */
const REQUEST_TIMEOUT_MS = 45_000;

/**
 * The portal endpoint ends with /responses, which the SDK appends itself — left on, every call
 * doubles the path and returns 405. Any query string on the endpoint (api-version) is kept.
 */
export function parseAgentEndpoint(endpoint: string, apiVersion?: string): { baseURL: string; query: Record<string, string> } {
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    throw new Error('Azure agent endpoint is not a valid URL');
  }
  if (url.hostname.endsWith('.openai.azure.com')) {
    throw new Error(
      'Azure agent endpoint is an Azure OpenAI resource URL; use the Endpoint from Agents in the Foundry portal (*.services.ai.azure.com)',
    );
  }
  const query = Object.fromEntries(url.searchParams);
  query['api-version'] ??= apiVersion || DEFAULT_AZURE_API_VERSION;
  const path = url.pathname.replace(/\/+$/, '').replace(/\/responses$/, '');
  return { baseURL: `${url.origin}${path}`, query };
}

const SECTION = (title: string, body: string) => `===== ${title} =====\n${body}`;

/**
 * Bundles a chat-style message list into the one user message the agent accepts:
 * system prompt → earlier turns (few-shot examples, conversation history) → the current message.
 */
export function toAgentInput(messages: ChatMessage[]): string {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content);
  const turns = messages.filter((m) => m.role !== 'system');
  const current = turns.at(-1);
  const earlier = turns.slice(0, -1);

  const sections: string[] = [];
  if (system.length > 0) sections.push(SECTION('SYSTEM INSTRUCTIONS', system.join('\n\n')));
  if (earlier.length > 0) {
    sections.push(
      SECTION('EARLIER TURNS', earlier.map((m) => `[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n')),
    );
  }
  if (current) sections.push(SECTION(`CURRENT ${current.role.toUpperCase()} MESSAGE`, current.content));
  return sections.join('\n\n');
}

/** Without JSON mode the agent may fence its JSON; keep the outermost object. */
export function unwrapJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

export type AgentResponse = {
  output_text?: string;
  output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  model?: string;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
  } | null;
};

/** The SDK's output_text, or the message output's text parts joined when it is absent. */
export function outputText(response: AgentResponse): string | null {
  if (typeof response.output_text === 'string') return response.output_text;
  const parts = (response.output ?? [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((c) => c.type === 'output_text' && typeof c.text === 'string')
    .map((c) => c.text!);
  return parts.length > 0 ? parts.join('') : null;
}

/** Agent-backed CompleteFn. SDK retries are off — withRetry owns the policy. */
export function createAzureAgentComplete(config: {
  apiKey: string;
  endpoint: string;
  apiVersion?: string;
  /** Test seam; defaults to the global fetch. */
  fetch?: typeof fetch;
}): CompleteFn {
  if (!config.apiKey) throw new AppError('INTERNAL', { details: { upstream: 'AZURE_API_KEY is empty' } });
  const { baseURL, query } = parseAgentEndpoint(config.endpoint, config.apiVersion);
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL,
    defaultQuery: query,
    // Azure wants the key in its own header as well as the standard Authorization one.
    defaultHeaders: { 'api-key': config.apiKey },
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 0,
    fetch: config.fetch ?? globalThis.fetch,
  });

  return async (messages, options, signal) => {
    // The SDK types require `model`; the agent rejects it. Cast to send only `input`.
    // deno-lint-ignore no-explicit-any
    const response: AgentResponse = await (client.responses as any).create(
      { input: [{ role: 'user', content: toAgentInput(messages) }] },
      { signal },
    );
    const text = outputText(response);
    const truncated = response.status === 'incomplete' && response.incomplete_details?.reason === 'max_output_tokens';
    return {
      content: text !== null && options.json ? unwrapJson(text) : text,
      finishReason: truncated ? 'length' : 'stop',
      usage: {
        prompt: response.usage?.input_tokens ?? 0,
        cached: response.usage?.input_tokens_details?.cached_tokens ?? 0,
        completion: response.usage?.output_tokens ?? 0,
      },
      model: response.model ?? null,
    };
  };
}
