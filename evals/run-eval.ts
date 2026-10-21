// AI evaluation harness (Spec 12 §12.9). Runs the real pipeline — extractPdf → runExtraction, the
// same code as process-contract minus the database — against live OpenAI, then scores and reports.
//
//   npm run eval -- [--type NDA|MSA|all] [--limit N] [--prompt-version v1] [--with-chat]
//                   [--gate beta|launch] [--dataset evals/datasets]
//
// Needs OPENAI_API_KEY (read from the environment or .env.local). Never runs in unit tests.
import { buildChatMessages, CHAT_SETTINGS } from '../supabase/functions/_shared/chat-context.ts';
import { costUsd } from '../supabase/functions/_shared/cost.ts';
import { newMeter, runExtraction } from '../supabase/functions/_shared/extraction.ts';
import { createOpenAIComplete, createOpenAIStream } from '../supabase/functions/_shared/openai.ts';
import { extractPdf } from '../supabase/functions/_shared/pdf-text.ts';
import { parseCitations } from '../supabase/functions/_shared/pure/citations.ts';
import { PROMPT_VERSION } from '../supabase/functions/_shared/pure/prompts-v1.ts';
import { classifyQuery } from '../supabase/functions/_shared/pure/query-classifier.ts';
import { loadDataset, type DatasetItem } from './lib/dataset.ts';
import { chatPasses, checkGate, resistsInjection, scoreTerm, type PredictedTerm } from './lib/metrics.ts';
import { renderMarkdown, summarise, type ContractResult } from './lib/report.ts';

type Args = { type: 'NDA' | 'MSA' | 'all'; limit: number; promptVersion: string; withChat: boolean; gate: 'beta' | 'launch' | null; dataset: string };

export function parseArgs(argv: string[]): Args {
  const args: Args = { type: 'all', limit: Infinity, promptVersion: PROMPT_VERSION, withChat: false, gate: null, dataset: 'evals/datasets' };
  for (let i = 0; i < argv.length; i++) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (flag === '--with-chat') args.withChat = true;
    else if (flag === '--type' && (value === 'NDA' || value === 'MSA' || value === 'all')) (args.type = value), i++;
    else if (flag === '--limit' && Number(value) > 0) (args.limit = Number(value)), i++;
    else if (flag === '--prompt-version' && value) (args.promptVersion = value), i++;
    else if (flag === '--gate' && (value === 'beta' || value === 'launch')) (args.gate = value), i++;
    else if (flag === '--dataset' && value) (args.dataset = value), i++;
    else throw new Error(`Unknown or invalid argument: ${flag}${value ? ` ${value}` : ''}`);
  }
  return args;
}

/** Fills unset variables from .env.local (KEY=VALUE lines); the real environment wins. */
async function loadLocalEnv() {
  try {
    for (const line of (await Deno.readTextFile('.env.local')).split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/.exec(line);
      if (m && !Deno.env.get(m[1]!) && m[2]) Deno.env.set(m[1]!, m[2].replace(/^['"]|['"]$/g, ''));
    }
  } catch {
    // CI sets the environment directly.
  }
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

const INJECTION_QUESTION = 'Which law governs this agreement?';

async function evaluate(item: DatasetItem & { pdfPath: string }, cfg: { apiKey: string; model: string; baseURL?: string; withChat: boolean }): Promise<ContractResult> {
  const complete = createOpenAIComplete({ apiKey: cfg.apiKey, model: cfg.model, baseURL: cfg.baseURL, userHash: 'eval' });
  const stream = createOpenAIStream({ apiKey: cfg.apiKey, model: cfg.model, baseURL: cfg.baseURL, userHash: 'eval' });
  const base: ContractResult = { id: item.id, contractType: item.contract_type, latencyMs: null, costUsd: null, terms: [], custom: [], chat: [], injection: null };

  let predictedStd = new Map<string, PredictedTerm>();
  let predictedCustom = new Map<string, PredictedTerm>();
  let contract: { text: string; pageCount: number } | null = null;
  try {
    const pdf = await extractPdf(await Deno.readFile(item.pdfPath));
    contract = { text: pdf.contractText, pageCount: pdf.pageCount };
    const meter = newMeter();
    const started = performance.now();
    const { terms } = await runExtraction({
      contractText: pdf.contractText,
      contractType: item.contract_type,
      customTerms: item.custom_terms.map((c) => c.name),
      complete,
      meter,
    });
    base.latencyMs = Math.round(performance.now() - started);
    base.costUsd = costUsd(cfg.model, meter.prompt, meter.cached, meter.completion).cost;
    const toPred = (t: (typeof terms)[number]): PredictedTerm => ({ value: t.value, page: t.page_number, confidence: t.confidence_score });
    predictedStd = new Map(terms.filter((t) => !t.is_custom).map((t) => [t.term_key, toPred(t)]));
    predictedCustom = new Map(terms.filter((t) => t.is_custom).map((t) => [t.term_name.toLowerCase(), toPred(t)]));
  } catch (e) {
    base.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }

  base.terms = Object.entries(item.terms).map(([key, gold]) => {
    const pred = predictedStd.get(key);
    return { key, name: key, gold, pred, outcome: scoreTerm(pred, gold) };
  });
  base.custom = item.custom_terms.map(({ name, expected }) => {
    const pred = predictedCustom.get(name.toLowerCase());
    return { key: `custom:${name}`, name, gold: expected, pred, outcome: scoreTerm(pred, expected) };
  });

  const ask = async (q: string) => {
    const messages = buildChatMessages({ queryType: classifyQuery(q, []), contractType: item.contract_type, contractText: contract!.text, history: [], question: q });
    let answer = '';
    for await (const chunk of await stream(messages, CHAT_SETTINGS, AbortSignal.timeout(45_000))) answer += chunk.text ?? '';
    return { answer, cited: parseCitations(answer, contract!.pageCount) };
  };

  if (contract && cfg.withChat) {
    for (const exp of item.chat) {
      try {
        const { answer, cited } = await ask(exp.q);
        base.chat.push({ ...exp, answer, cited, pass: chatPasses(exp, answer, cited) });
      } catch (e) {
        base.chat.push({ ...exp, answer: `ERROR ${String(e)}`, cited: [], pass: false });
      }
    }
  }

  if (item.injection) {
    if (!contract || base.error) base.injection = { pass: false, detail: `pipeline error: ${base.error}` };
    else {
      const extracted = predictedStd.get('governing_law')?.value ?? null;
      const { answer } = await ask(INJECTION_QUESTION).catch((e) => ({ answer: `ERROR ${String(e)}` }));
      const pass = resistsInjection(extracted) && resistsInjection(answer) && !answer.startsWith('ERROR');
      base.injection = { pass, detail: `governing_law=${JSON.stringify(extracted)}; chat=${JSON.stringify(answer.slice(0, 200))}` };
    }
  }
  return base;
}

async function main() {
  const args = parseArgs(Deno.args);
  if (args.promptVersion !== PROMPT_VERSION) {
    throw new Error(`Prompt ${args.promptVersion} isn't in this build (current: ${PROMPT_VERSION}). Bump PROMPT_VERSION with the new prompts first.`);
  }
  await loadLocalEnv();
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set (environment or .env.local). The eval calls live OpenAI.');
  const model = Deno.env.get('OPENAI_MODEL') || 'gpt-4o-mini';
  const baseURL = Deno.env.get('OPENAI_BASE_URL') || undefined;

  const all = await loadDataset(args.dataset);
  const items = all.filter((i) => args.type === 'all' || i.contract_type === args.type).slice(0, args.limit);
  if (items.length === 0) throw new Error(`No dataset items in ${args.dataset} for --type ${args.type}`);
  console.log(`Evaluating ${items.length} contract(s) with ${model}, prompt ${PROMPT_VERSION}…`);

  const results = await pool(items, 4, async (item) => {
    const r = await evaluate(item, { apiKey, model, baseURL, withChat: args.withChat });
    console.log(`  ${r.error ? '✗' : '✓'} ${r.id}${r.error ? ` — ${r.error}` : ` (${((r.latencyMs ?? 0) / 1000).toFixed(1)} s)`}`);
    return r;
  });

  const summary = summarise(results);
  const gate = args.gate ? { name: args.gate, results: checkGate(summary, args.gate) } : null;
  const date = new Date().toISOString().slice(0, 10);
  const stem = `evals/reports/${date}-${PROMPT_VERSION}`;
  await Deno.writeTextFile(`${stem}.json`, JSON.stringify({ date, model, promptVersion: PROMPT_VERSION, args: { ...args, limit: Number.isFinite(args.limit) ? args.limit : null }, summary, gate, results }, null, 2));
  const markdown = renderMarkdown({ date, promptVersion: PROMPT_VERSION, model, results, summary, gate });
  await Deno.writeTextFile(`${stem}.md`, markdown);
  console.log(`\n${markdown.split('\n## Per-term')[0]}\nReports: ${stem}.json, ${stem}.md`);

  if (gate && !gate.results.every((g) => g.pass)) Deno.exit(1);
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    Deno.exit(2);
  });
}
