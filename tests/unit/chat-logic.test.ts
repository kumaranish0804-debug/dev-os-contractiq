// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expandCitation, parseCitations, splitCitations } from '@shared/citations';
import {
  CHAT_SYSTEM_HISTORY_V1,
  CHAT_SYSTEM_V1,
  renderChatSystem,
} from '@shared/prompts-v1';
import { classifyQuery } from '@shared/query-classifier';
import { readSse } from '@/lib/api/sse';

describe('citations', () => {
  it('parses single pages, lists, ranges and plurals; unique, ascending, in range', () => {
    const text = 'See [Page 3] and [Pages 7, 2] plus [Page 4-6] and [page 9] then [Pages 1 and 3] [Page 99].';
    expect(parseCitations(text, 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 9]);
  });

  it('expands bodies and ignores reversed or huge ranges', () => {
    expect(expandCitation('3 & 5')).toEqual([3, 5]);
    expect(expandCitation('5–3')).toEqual([]);
    expect(expandCitation('1-999')).toEqual([]);
  });

  it('ignores text that only looks like a citation', () => {
    expect(parseCitations('page 3, [PAGE] [Page x] (Page 2)', 5)).toEqual([]);
  });

  it('splits text into runs and one citation per page', () => {
    expect(splitCitations('Fees are net 30 [Pages 2, 4].')).toEqual([
      { type: 'text', value: 'Fees are net 30 ' },
      { type: 'citation', page: 2 },
      { type: 'citation', page: 4 },
      { type: 'text', value: '.' },
    ]);
    expect(splitCitations('No citations.')).toEqual([{ type: 'text', value: 'No citations.' }]);
  });
});

describe('classifyQuery', () => {
  const history = [{}];
  it.each([
    ['What is the governing law?', history, 'contract'],
    ['What did you say earlier?', [], 'contract'],
    ['What did you say earlier?', history, 'history'],
    ['What did you say earlier about termination?', history, 'both'],
    ['Summarise our conversation', history, 'history'],
    ['Previously you mentioned the liability cap — is it per claim?', history, 'both'],
  ] as const)('%s → %s', (q, h, expected) => {
    expect(classifyQuery(q, [...h])).toBe(expected);
  });
});

describe('chat prompts mirror the canonical files', () => {
  const read = (f: string) => readFileSync(resolve(__dirname, '../../prompts/v1', f), 'utf8').replace(/\n$/, '');

  it('matches chat-system.md and chat-system-history.md', () => {
    expect(CHAT_SYSTEM_V1).toBe(read('chat-system.md'));
    expect(CHAT_SYSTEM_HISTORY_V1).toBe(read('chat-system-history.md'));
  });

  it('renders contract and both variants, filling every placeholder', () => {
    const contract = renderChatSystem({ queryType: 'contract', contractType: 'MSA', contractText: 'Fees $5 [PAGE 1]' });
    expect(contract).not.toContain('{{');
    expect(contract).toContain('inside <contract>…</contract>. Never use');
    expect(contract).toContain('Contract type: MSA\n<contract>\nFees $5 [PAGE 1]\n</contract>');

    const both = renderChatSystem({ queryType: 'both', contractType: 'NDA', contractText: 'x' });
    expect(both).toContain('</contract> and our previous messages in this conversation. Never use');
  });

  it('does not interpret $ patterns in the contract text', () => {
    expect(renderChatSystem({ queryType: 'contract', contractType: 'NDA', contractText: "$& $1 $'" })).toContain("$& $1 $'");
  });
});

describe('readSse', () => {
  const streamOf = (...chunks: string[]) =>
    new Response(
      new ReadableStream({
        start(c) {
          for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk));
          c.close();
        },
      }),
    );

  it('reassembles events split across chunks and skips heartbeats', async () => {
    const res = streamOf(
      'event: meta\ndata: {"a"',
      ':1}\n\n: ping\n\nevent: delta\ndata: {"text":"Hi"}\n',
      '\nevent: done\r\ndata: {"cited_pages":[2]}\r\n\r\n',
    );
    const events = [];
    for await (const e of readSse(res)) events.push(e);
    expect(events).toEqual([
      { event: 'meta', data: { a: 1 } },
      { event: 'delta', data: { text: 'Hi' } },
      { event: 'done', data: { cited_pages: [2] } },
    ]);
  });
});

// ---------------------------------------------------------------------------
// GET /api/contracts/[id]/chat
// ---------------------------------------------------------------------------
const getUser = vi.fn();
const tableResults: Record<string, { data: unknown; error: null | { message: string } }> = {};
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser },
    from: (table: string) => {
      const result = () => Promise.resolve(tableResults[table] ?? { data: null, error: null });
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'limit']) chain[m] = () => chain;
      chain.maybeSingle = result;
      chain.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => result().then(ok, bad);
      return chain;
    },
  }),
}));

const { GET } = await import('@/app/api/contracts/[id]/chat/route');
const ID = '99999999-9999-4999-8999-999999999999';
const call = (id = ID) => GET(new Request(`http://x/api/contracts/${id}/chat`), { params: { id } });

describe('GET /api/contracts/[id]/chat', () => {
  beforeEach(() => {
    getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1' } } });
    for (const k of Object.keys(tableResults)) delete tableResults[k];
  });

  it('returns an empty conversation when there is no session yet', async () => {
    tableResults.contracts = { data: { id: ID, status: 'completed' }, error: null };
    const res = await call();
    expect(await res.json()).toEqual({ session_id: null, message_count: 0, messages: [] });
  });

  it('returns the session messages', async () => {
    tableResults.contracts = { data: { id: ID, status: 'completed' }, error: null };
    tableResults.chat_sessions = { data: { id: 's1', message_count: 2 }, error: null };
    tableResults.chat_messages = { data: [{ id: 'm1', role: 'user', content: 'Hi' }], error: null };
    const body = await (await call()).json();
    expect(body.session_id).toBe('s1');
    expect(body.message_count).toBe(2);
    expect(body.messages).toHaveLength(1);
  });

  it('404 for unknown contracts and malformed ids; 401 signed out', async () => {
    expect((await call()).status).toBe(404);
    expect((await call('bad')).status).toBe(404);
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await call()).status).toBe(401);
  });
});
