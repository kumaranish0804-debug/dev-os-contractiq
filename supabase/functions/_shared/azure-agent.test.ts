import { assert, assertEquals, assertThrows } from 'std/assert';
import {
  createAzureAgentComplete,
  DEFAULT_AZURE_API_VERSION,
  outputText,
  parseAgentEndpoint,
  toAgentInput,
  unwrapJson,
} from './azure-agent.ts';

const ENDPOINT = 'https://acme.services.ai.azure.com/api/projects/ciq/applications/chat/protocols/openai/responses';

Deno.test('parseAgentEndpoint strips the trailing /responses (else every call 405s)', () => {
  const { baseURL, query } = parseAgentEndpoint(ENDPOINT);
  assertEquals(baseURL, 'https://acme.services.ai.azure.com/api/projects/ciq/applications/chat/protocols/openai');
  assertEquals(query, { 'api-version': DEFAULT_AZURE_API_VERSION });
  assertEquals(parseAgentEndpoint(`${ENDPOINT}/`).baseURL, baseURL);
});

Deno.test('parseAgentEndpoint keeps the portal api-version, else the override, else the default', () => {
  assertEquals(parseAgentEndpoint(`${ENDPOINT}?api-version=2026-01-01-preview`, 'ignored').query, {
    'api-version': '2026-01-01-preview',
  });
  assertEquals(parseAgentEndpoint(ENDPOINT, '2026-02-01').query, { 'api-version': '2026-02-01' });
});

Deno.test('parseAgentEndpoint rejects the Azure OpenAI resource URL and junk', () => {
  assertThrows(() => parseAgentEndpoint('https://acme.openai.azure.com/openai/responses'), Error, 'Agents');
  assertThrows(() => parseAgentEndpoint('not a url'), Error, 'valid URL');
});

Deno.test('toAgentInput bundles system, earlier turns and the current message into one text', () => {
  const text = toAgentInput([
    { role: 'system', content: 'Answer from the contract.' },
    { role: 'user', content: 'q0' },
    { role: 'assistant', content: 'a0' },
    { role: 'user', content: 'What law governs?' },
  ]);
  const at = (s: string) => text.indexOf(s);
  assert(at('===== SYSTEM INSTRUCTIONS =====\nAnswer from the contract.') === 0);
  assert(at('===== EARLIER TURNS =====\n[USER]\nq0\n\n[ASSISTANT]\na0') > 0);
  assert(at('===== CURRENT USER MESSAGE =====\nWhat law governs?') > at('[ASSISTANT]\na0'));
  assertEquals(toAgentInput([{ role: 'user', content: 'hi' }]), '===== CURRENT USER MESSAGE =====\nhi');
});

Deno.test('unwrapJson removes fences around the JSON object', () => {
  assertEquals(unwrapJson('```json\n{"a":{"b":1}}\n```'), '{"a":{"b":1}}');
  assertEquals(unwrapJson('no json here'), 'no json here');
});

Deno.test('outputText falls back to the message output parts', () => {
  assertEquals(outputText({ output_text: 'direct' }), 'direct');
  assertEquals(
    outputText({
      output: [
        { type: 'reasoning' },
        { type: 'message', content: [{ type: 'output_text', text: 'Hel' }, { type: 'output_text', text: 'lo' }] },
      ],
    }),
    'Hello',
  );
  assertEquals(outputText({}), null);
});

Deno.test('createAzureAgentComplete sends only `input`, with both auth headers, and maps usage', async () => {
  const seen: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetchStub = async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    seen.push({ url: req.url, headers: req.headers, body: await req.json() });
    return Response.json({
      id: 'resp_1',
      object: 'response',
      status: 'completed',
      model: 'gpt-4o-mini-2024-07-18',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '```json\n{"ok":true}\n```' }] }],
      usage: { input_tokens: 120, output_tokens: 8, input_tokens_details: { cached_tokens: 20 } },
    });
  };
  const complete = createAzureAgentComplete({ apiKey: 'k-123', endpoint: ENDPOINT, fetch: fetchStub });
  const result = await complete(
    [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }],
    { temperature: 0.1, maxTokens: 2000, json: true },
  );

  assertEquals(result, {
    content: '{"ok":true}',
    finishReason: 'stop',
    usage: { prompt: 120, cached: 20, completion: 8 },
    model: 'gpt-4o-mini-2024-07-18',
  });

  const [call] = seen;
  assertEquals(
    call!.url,
    `https://acme.services.ai.azure.com/api/projects/ciq/applications/chat/protocols/openai/responses?api-version=${DEFAULT_AZURE_API_VERSION}`,
  );
  assertEquals(call!.headers.get('api-key'), 'k-123');
  assertEquals(call!.headers.get('authorization'), 'Bearer k-123');
  // The agent rejects model / instructions / temperature / token-limit overrides.
  assertEquals(Object.keys(call!.body), ['input']);
  assertEquals(call!.body.input, [{ role: 'user', content: '===== SYSTEM INSTRUCTIONS =====\nS\n\n===== CURRENT USER MESSAGE =====\nU' }]);
});

Deno.test('a max_output_tokens cut-off reports finishReason length', async () => {
  const fetchStub = () =>
    Promise.resolve(
      Response.json({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output_text: '{"terms": [' }),
    );
  const complete = createAzureAgentComplete({ apiKey: 'k', endpoint: ENDPOINT, fetch: fetchStub });
  const result = await complete([{ role: 'user', content: 'U' }], { temperature: 0, maxTokens: 10, json: false });
  assertEquals(result.finishReason, 'length');
});
