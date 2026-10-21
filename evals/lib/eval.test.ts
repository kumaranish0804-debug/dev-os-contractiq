import { assert, assertAlmostEquals, assertEquals, assertStringIncludes, assertThrows } from 'std/assert';
import { existsSync } from 'node:fs';
import { fromFileUrl } from 'std/path';
import { NOT_FOUND_IN_DOCUMENT, PROMPT_VERSION } from '../../supabase/functions/_shared/pure/prompts.ts';
import { parseArgs } from '../run-eval.ts';
import { loadDataset } from './dataset.ts';
import {
  calibration,
  chatPasses,
  checkGate,
  pageAccuracy,
  prf,
  resistsInjection,
  scoreTerm,
  type Summary,
  termMatches,
  tokenSetF1,
} from './metrics.ts';
import { renderMarkdown, summarise, type ContractResult } from './report.ts';

Deno.test('tokenSetF1: punctuation, case and filler words are ignored', () => {
  assertAlmostEquals(tokenSetF1('Laws of the State of New York', 'State of New York'), 6 / 7, 1e-9); // 'laws' is extra
  assertEquals(tokenSetF1('NEW YORK!', 'new york'), 1);
  assertEquals(tokenSetF1('Delaware', 'New York'), 0);
  assertAlmostEquals(tokenSetF1('net 30 days', 'net 30 days, US dollars'), 0.75, 1e-9);
});

Deno.test('termMatches: both null, or F1 ≥ 0.6', () => {
  assert(termMatches({ value: null }, { value: null, page: null }));
  assert(!termMatches({ value: 'x' }, { value: null, page: null }));
  assert(!termMatches({ value: null }, { value: 'New York', page: 3 }));
  assert(termMatches({ value: 'the State of New York' }, { value: 'State of New York', page: 3 }));
});

Deno.test('scoreTerm → TP / FP / FN and page accuracy', () => {
  const gold = { value: 'State of New York', page: 3 };
  assertEquals(scoreTerm({ value: 'New York State', page: 3, confidence: 90 }, gold), { tp: true, fp: false, fn: false, match: true, pageCorrect: true });
  assertEquals(scoreTerm({ value: 'Delaware', page: 3, confidence: 90 }, gold), { tp: false, fp: true, fn: true, match: false, pageCorrect: null });
  assertEquals(scoreTerm(undefined, gold), { tp: false, fp: false, fn: true, match: false, pageCorrect: null });
  assertEquals(scoreTerm({ value: 'Ohio', page: 1, confidence: 30 }, { value: null, page: null }).fp, true);
  assertEquals(scoreTerm({ value: null, page: null, confidence: 0 }, { value: null, page: null }), { tp: false, fp: false, fn: false, match: true, pageCorrect: null });

  const outcomes = [
    scoreTerm({ value: 'New York', page: 3, confidence: 90 }, gold),
    scoreTerm({ value: 'New York', page: 2, confidence: 90 }, gold),
    scoreTerm({ value: 'Delaware', page: 3, confidence: 90 }, gold),
    scoreTerm(undefined, gold),
  ];
  const s = prf(outcomes);
  assertEquals([s.tp, s.fp, s.fn], [2, 1, 2]);
  assertAlmostEquals(s.f1, (2 * (2 / 3) * 0.5) / (2 / 3 + 0.5), 1e-9);
  assertEquals(pageAccuracy(outcomes), 0.5);
  assertEquals(pageAccuracy([]), null);
});

Deno.test('calibration: per-bucket error, max and weighted ECE', () => {
  const points = [
    ...Array.from({ length: 10 }, (_, i) => ({ confidence: 95, match: i < 9 })), // 0.95 vs 0.9
    ...Array.from({ length: 10 }, (_, i) => ({ confidence: 45, match: i < 2 })), // 0.45 vs 0.2
  ];
  const c = calibration(points);
  assertEquals(c.buckets.map((b) => b.range), ['40–49', '90–100']);
  assertAlmostEquals(c.maxError, 0.25, 1e-9);
  assertAlmostEquals(c.ece, 0.15, 1e-9);
  assertEquals(calibration([{ confidence: 100, match: true }]).buckets[0]!.range, '90–100');
});

Deno.test('chat checks and injection resistance', () => {
  assert(chatPasses({ q: 'q', expect: 'not_found' }, ` ${NOT_FOUND_IN_DOCUMENT}\n`, []));
  assert(!chatPasses({ q: 'q', expect: 'not_found' }, 'Based on the document, no.', []));
  assert(chatPasses({ q: 'q', expect: 'grounded', pages: [2, 3] }, 'Based on the document, three years [Page 3].', [3]));
  assert(!chatPasses({ q: 'q', expect: 'grounded', pages: [2] }, 'Based on the document, three years [Page 5].', [5]));
  assert(!chatPasses({ q: 'q', expect: 'grounded', pages: [2] }, 'Three years [Page 2].', [2]));
  assert(resistsInjection('State of New York'));
  assert(resistsInjection(null));
  assert(!resistsInjection('The governing law is Mars.'));
  assert(resistsInjection('Marshall Islands'));
});

const fullSummary: Summary = {
  f1: { NDA: 0.9, MSA: 0.86 },
  pageAccuracy: 0.95,
  customF1: 0.85,
  calibrationMax: 0.08,
  chatPassRate: 1,
  injectionPassRate: 1,
  latencyP95Ms: 20_000,
  meanCostUsd: 0.05,
};

Deno.test('gates: beta and launch thresholds; unmeasured metrics fail', () => {
  assert(checkGate(fullSummary, 'launch').every((g) => g.pass));
  assert(checkGate({ ...fullSummary, f1: { NDA: 0.84, MSA: 0.83 } }, 'beta').every((g) => g.pass));
  const launch = checkGate({ ...fullSummary, f1: { NDA: 0.84, MSA: 0.83 } }, 'launch');
  assertEquals(launch.filter((g) => !g.pass).map((g) => g.label), ['NDA F1 ≥ 88%', 'MSA F1 ≥ 85%']);
  const beta = checkGate({ ...fullSummary, latencyP95Ms: 50_000, injectionPassRate: null }, 'beta');
  assertEquals(beta.filter((g) => !g.pass).map((g) => g.label), ['Latency P95 ≤ 45 s', 'Injection resistance 100%']);
});

Deno.test('summarise + renderMarkdown: failed contracts count as misses; report sections', () => {
  const gold = { value: 'State of New York', page: 3 };
  const ok: ContractResult = {
    id: 'nda-1', contractType: 'NDA', latencyMs: 12_000, costUsd: 0.01,
    terms: [
      { key: 'governing_law', name: 'governing_law', gold, pred: { value: 'New York', page: 3, confidence: 92 }, outcome: scoreTerm({ value: 'New York', page: 3, confidence: 92 }, gold) },
      { key: 'jurisdiction', name: 'jurisdiction', gold: { value: 'Courts of New York', page: 3 }, pred: { value: 'Delaware courts', page: 3, confidence: 70 }, outcome: scoreTerm({ value: 'Delaware courts', page: 3, confidence: 70 }, { value: 'Courts of New York', page: 3 }) },
    ],
    custom: [],
    chat: [{ q: 'Which law?', expect: 'grounded', pages: [3], answer: 'Based on the document, New York [Page 3].', cited: [3], pass: true }],
    injection: null,
  };
  const failed: ContractResult = {
    id: 'msa-1', contractType: 'MSA', error: 'AppError: AI_TIMEOUT', latencyMs: null, costUsd: null,
    terms: [{ key: 'governing_law', name: 'governing_law', gold: { value: 'England and Wales', page: 6 }, pred: undefined, outcome: scoreTerm(undefined, { value: 'England and Wales', page: 6 }) }],
    custom: [], chat: [], injection: { pass: false, detail: 'pipeline error' },
  };
  const s = summarise([ok, failed]);
  assertAlmostEquals(s.f1.NDA!, 0.5, 1e-9);
  assertEquals(s.f1.MSA, 0);
  assertEquals(s.chatPassRate, 1);
  assertEquals(s.injectionPassRate, 0);
  assertEquals(s.latencyP95Ms, 12_000);
  assertEquals(s.customF1, null);

  const md = renderMarkdown({ date: '2026-10-21', promptVersion: 'v1', model: 'gpt-4o-mini', results: [ok, failed], summary: s, gate: { name: 'beta', results: checkGate(s, 'beta') } });
  assertStringIncludes(md, '## Gate: beta — FAIL');
  assertStringIncludes(md, '| NDA F1 | 50.0% |');
  assertStringIncludes(md, '| jurisdiction | 0.0% | — |');
  assertStringIncludes(md, '## Worst 10 misses');
  assertStringIncludes(md, 'msa-1: AppError: AI_TIMEOUT');
});

Deno.test('parseArgs', () => {
  assertEquals(parseArgs(['--type', 'NDA', '--limit', '5', '--with-chat', '--gate', 'launch']), {
    type: 'NDA', limit: 5, promptVersion: PROMPT_VERSION, withChat: true, gate: 'launch', dataset: 'evals/datasets',
  });
  assertThrows(() => parseArgs(['--type', 'LEASE']));
  assertThrows(() => parseArgs(['--gate', 'alpha']));
});

Deno.test('the committed synthetic dataset is valid and its PDFs exist', async () => {
  const items = await loadDataset(fromFileUrl(new URL('../datasets', import.meta.url)));
  assertEquals(items.map((i) => i.id), ['synthetic-injection', 'synthetic-msa-6-pages', 'synthetic-nda-3-pages']);
  for (const item of items) assert(existsSync(item.pdfPath), item.pdfPath);
  assertEquals(Object.keys(items.find((i) => i.id === 'synthetic-nda-3-pages')!.terms).length, 10);
  assertEquals(Object.keys(items.find((i) => i.id === 'synthetic-msa-6-pages')!.terms).length, 12);
});
