// Aggregation and the Markdown report (Spec 12 §12.9 "Output"). Pure — unit-tested.
import {
  calibration,
  type ChatExpectation,
  type GateResult,
  type GoldTerm,
  pageAccuracy,
  percentileCont,
  prf,
  type PredictedTerm,
  type Summary,
  type TermOutcome,
  tokenSetF1,
} from './metrics.ts';

export type TermResult = { key: string; name: string; gold: GoldTerm; pred: PredictedTerm | undefined; outcome: TermOutcome };

export type ContractResult = {
  id: string;
  contractType: 'NDA' | 'MSA';
  /** Set when the pipeline threw; every gold term then counts as missed. */
  error?: string;
  latencyMs: number | null;
  costUsd: number | null;
  terms: TermResult[];
  custom: TermResult[];
  chat: (ChatExpectation & { answer: string; cited: number[]; pass: boolean })[];
  injection: { pass: boolean; detail: string } | null;
};

const rate = (xs: boolean[]) => (xs.length ? xs.filter(Boolean).length / xs.length : null);

export function summarise(results: ContractResult[]): Summary {
  const f1For = (type: 'NDA' | 'MSA') => {
    const outcomes = results.filter((r) => r.contractType === type).flatMap((r) => r.terms.map((t) => t.outcome));
    return outcomes.length ? prf(outcomes).f1 : null;
  };
  const custom = results.flatMap((r) => r.custom.map((t) => t.outcome));
  const scored = results.flatMap((r) => [...r.terms, ...r.custom]).filter((t) => t.pred);
  const ok = results.filter((r) => !r.error);
  const costs = ok.map((r) => r.costUsd).filter((c): c is number => c !== null);
  return {
    f1: { NDA: f1For('NDA'), MSA: f1For('MSA') },
    pageAccuracy: pageAccuracy(results.flatMap((r) => r.terms.map((t) => t.outcome))),
    customF1: custom.length ? prf(custom).f1 : null,
    calibrationMax: scored.length ? calibration(scored.map((t) => ({ confidence: t.pred!.confidence, match: t.outcome.match }))).maxError : null,
    chatPassRate: rate(results.flatMap((r) => r.chat.map((c) => c.pass))),
    injectionPassRate: rate(results.filter((r) => r.injection).map((r) => r.injection!.pass)),
    latencyP95Ms: percentileCont(ok.map((r) => r.latencyMs).filter((l): l is number => l !== null), 0.95),
    meanCostUsd: costs.length ? costs.reduce((a, c) => a + c, 0) / costs.length : null,
  };
}

const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);

function formatGateValue({ metric, actual }: GateResult): string {
  if (actual === null) return 'not measured';
  if (metric === 'latencyP95Ms') return `${(actual / 1000).toFixed(1)} s`;
  if (metric === 'meanCostUsd') return `$${actual.toFixed(3)}`;
  if (metric === 'calibrationMax') return actual.toFixed(3);
  return pct(actual);
}
const cell = (s: string | null) => (s === null ? '_null_' : s.replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 120));

export function renderMarkdown(input: {
  date: string;
  promptVersion: string;
  model: string;
  results: ContractResult[];
  summary: Summary;
  gate: { name: 'beta' | 'launch'; results: GateResult[] } | null;
}): string {
  const { summary: s, results } = input;
  const lines: string[] = [];
  lines.push(`# ContractIQ eval — ${input.date} — prompt ${input.promptVersion}`, '');
  lines.push(`Model \`${input.model}\` · ${results.length} contracts (${results.filter((r) => r.error).length} failed)`, '');

  lines.push('## Summary', '', '| Metric | Value |', '|---|---|');
  lines.push(`| NDA F1 | ${pct(s.f1.NDA)} |`, `| MSA F1 | ${pct(s.f1.MSA)} |`, `| Page accuracy | ${pct(s.pageAccuracy)} |`);
  lines.push(`| Custom-term F1 | ${pct(s.customF1)} |`, `| Calibration max error | ${s.calibrationMax?.toFixed(3) ?? '—'} |`);
  lines.push(`| Chat groundedness | ${pct(s.chatPassRate)} |`, `| Injection resistance | ${pct(s.injectionPassRate)} |`);
  lines.push(`| Latency P95 | ${s.latencyP95Ms === null ? '—' : `${(s.latencyP95Ms / 1000).toFixed(1)} s`} |`);
  lines.push(`| Mean cost / extraction | ${s.meanCostUsd === null ? '—' : `$${s.meanCostUsd.toFixed(4)}`} |`, '');

  if (input.gate) {
    const passed = input.gate.results.every((g) => g.pass);
    lines.push(`## Gate: ${input.gate.name} — ${passed ? 'PASS' : 'FAIL'}`, '', '| Gate | Actual | Result |', '|---|---|---|');
    for (const g of input.gate.results) {
      lines.push(`| ${g.label} | ${formatGateValue(g)} | ${g.pass ? '✅' : '❌'} |`);
    }
    lines.push('');
  }

  // Per-term F1 "heatmap" as a table: term × contract type.
  const byTerm = new Map<string, Map<'NDA' | 'MSA', TermOutcome[]>>();
  for (const r of results) {
    for (const t of r.terms) {
      const row = byTerm.get(t.key) ?? new Map();
      row.set(r.contractType, [...(row.get(r.contractType) ?? []), t.outcome]);
      byTerm.set(t.key, row);
    }
  }
  lines.push('## Per-term F1', '', '| Term | NDA | MSA |', '|---|---|---|');
  for (const [key, row] of [...byTerm].sort(([a], [b]) => a.localeCompare(b))) {
    const f = (type: 'NDA' | 'MSA') => (row.get(type) ? pct(prf(row.get(type)!).f1) : '—');
    lines.push(`| ${key} | ${f('NDA')} | ${f('MSA')} |`);
  }
  lines.push('');

  const misses = results
    .flatMap((r) => [...r.terms, ...r.custom].filter((t) => !t.outcome.match).map((t) => ({ id: r.id, ...t })))
    .map((m) => ({ ...m, score: m.gold.value && m.pred?.value ? tokenSetF1(m.pred.value, m.gold.value) : 0 }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 10);
  lines.push('## Worst 10 misses', '');
  if (misses.length === 0) lines.push('None.', '');
  else {
    lines.push('| Contract | Term | Expected (page) | Predicted (page, confidence) | F1 |', '|---|---|---|---|---|');
    for (const m of misses) {
      lines.push(
        `| ${m.id} | ${m.key} | ${cell(m.gold.value)} (${m.gold.page ?? '—'}) | ${cell(m.pred?.value ?? null)} (${m.pred?.page ?? '—'}, ${m.pred?.confidence ?? 0}%) | ${m.score.toFixed(2)} |`,
      );
    }
    lines.push('');
  }

  const failedChats = results.flatMap((r) => r.chat.filter((c) => !c.pass).map((c) => ({ id: r.id, ...c })));
  if (failedChats.length) {
    lines.push('## Failed chat checks', '', '| Contract | Question | Expected | Answer |', '|---|---|---|---|');
    for (const c of failedChats) {
      lines.push(`| ${c.id} | ${cell(c.q)} | ${c.expect === 'grounded' ? `grounded, pages ${c.pages.join(', ')}` : 'not found'} | ${cell(c.answer)} |`);
    }
    lines.push('');
  }
  const errors = results.filter((r) => r.error);
  if (errors.length) {
    lines.push('## Pipeline errors', '', ...errors.map((r) => `- ${r.id}: ${r.error}`), '');
  }
  return lines.join('\n');
}
