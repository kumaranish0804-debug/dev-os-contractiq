// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildExtractionUserMessage,
  EXTRACTION_SYSTEM_V1,
  FEW_SHOT_MSA,
  FEW_SHOT_NDA,
  PROMPT_VERSION,
} from '@shared/prompts';
import {
  customTermDef,
  getStandardTerms,
  isStandardTermName,
  TERM_LIBRARY,
  toCustomTermKey,
} from '@shared/term-library';
import { findSentencePage, normaliseForMatch } from '@shared/text-normalise';

const promptsDir = resolve(__dirname, '../../prompts', PROMPT_VERSION);
const read = (name: string) => readFileSync(resolve(promptsDir, name), 'utf8');

describe('prompts v1 mirror the canonical files', () => {
  it('system prompt', () => {
    expect(EXTRACTION_SYSTEM_V1).toBe(read('extraction-system.md').replace(/\n$/, ''));
  });

  it('few-shot examples', () => {
    expect(FEW_SHOT_NDA).toEqual(JSON.parse(read('few-shot-nda.json')));
    expect(FEW_SHOT_MSA).toEqual(JSON.parse(read('few-shot-msa.json')));
  });

  it('few-shot examples only use their own library keys and verbatim sources', () => {
    for (const [type, examples] of [['NDA', FEW_SHOT_NDA], ['MSA', FEW_SHOT_MSA]] as const) {
      const keys = new Set(getStandardTerms(type).map((t) => t.key));
      for (const example of examples) {
        expect(example.requested.every((k) => keys.has(k))).toBe(true);
        expect(example.output.terms.map((t) => t.term_key)).toEqual(example.requested);
        for (const t of example.output.terms) {
          if (t.source_sentence) expect(example.contract).toContain(t.source_sentence);
        }
      }
    }
  });

  it('builds the user message template', () => {
    expect(
      buildExtractionUserMessage({
        contractType: 'NDA',
        requested: [{ key: 'parties', name: 'Parties', description: 'Who signs' }],
        contractText: '[PAGE 1]\nHello',
      }),
    ).toBe(
      'Contract type selected by the user: NDA\n\nRequested terms (term_key — term_name: what to extract):\n- parties — Parties: Who signs\n\n<contract>\n[PAGE 1]\nHello\n</contract>',
    );
  });
});

describe('term library', () => {
  it('has 10 NDA and 12 MSA terms with unique keys', () => {
    expect(TERM_LIBRARY.NDA).toHaveLength(10);
    expect(TERM_LIBRARY.MSA).toHaveLength(12);
    for (const terms of Object.values(TERM_LIBRARY)) {
      expect(new Set(terms.map((t) => t.key)).size).toBe(terms.length);
      for (const t of terms) expect(t.key).toMatch(/^[a-z0-9_]{2,80}$/);
    }
  });

  it('slugs custom term keys within the DB key format', () => {
    expect(toCustomTermKey('Audit rights')).toBe('custom_audit_rights');
    expect(toCustomTermKey('  Non-compete (radius)! ')).toBe('custom_non_compete_radius');
    expect(toCustomTermKey('x'.repeat(100))).toMatch(/^custom_x{60}$/);
    expect(customTermDef(' Data location ')).toMatchObject({
      key: 'custom_data_location',
      name: 'Data location',
      glossary: 'Custom term you added',
    });
  });

  it('detects standard names case- and space-insensitively, per type', () => {
    expect(isStandardTermName('NDA', '  governing   LAW ')).toBe(true);
    expect(isStandardTermName('NDA', 'Payment Terms')).toBe(false);
    expect(isStandardTermName('MSA', 'payment terms')).toBe(true);
  });
});

describe('source sentence matching', () => {
  const pages = [
    { page: 1, text: 'The “Agreement” starts today.' },
    { page: 2, text: 'Either party may terminate on thirty (30)\ndays’ notice — in writing.' },
  ];

  it('normalises quotes, dashes, case and whitespace', () => {
    expect(normaliseForMatch('  “Hello”  —  World’s\n')).toBe('hello" - world\'s');
  });

  it('finds the sentence on another page than claimed', () => {
    expect(
      findSentencePage(pages, "either party may terminate on thirty (30) days' notice - in writing.", 1),
    ).toEqual({ page: 2, found: true });
  });

  it('prefers the claimed page and reports misses', () => {
    expect(findSentencePage(pages, 'The "Agreement" starts today.', 1)).toEqual({ page: 1, found: true });
    expect(findSentencePage(pages, 'Not in the document.', 1)).toEqual({ page: null, found: false });
    expect(findSentencePage(pages, '', 1)).toEqual({ page: null, found: false });
  });

  it('matches long sentences on their first 120 characters', () => {
    const long = `${'Clause '.repeat(20)}ends here.`;
    const doc = [{ page: 3, text: `${'Clause '.repeat(20)}ends differently in the PDF.` }];
    expect(findSentencePage(doc, long, null)).toEqual({ page: 3, found: true });
  });
});
