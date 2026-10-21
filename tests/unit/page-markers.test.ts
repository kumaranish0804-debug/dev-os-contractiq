import { describe, expect, it } from 'vitest';
import { safeFilename, titleFromFilename } from '@shared/filenames';
import {
  buildContractText,
  cleanPageText,
  countWords,
  PAGE_MARKER_RE,
  splitPages,
} from '@shared/page-markers';

describe('page markers', () => {
  it('round-trips build → split', () => {
    const pages = ['First page text.', 'Second page.\nWith two lines.', 'Third.'];
    const text = buildContractText(pages);
    expect(text.startsWith('[PAGE 1]\nFirst page text.')).toBe(true);
    expect(splitPages(text)).toEqual(pages.map((t, i) => ({ page: i + 1, text: t })));
  });

  it('keeps numbering when a page is empty', () => {
    const text = buildContractText(['One', '', 'Three']);
    expect(splitPages(text)).toEqual([
      { page: 1, text: 'One' },
      { page: 2, text: '' },
      { page: 3, text: 'Three' },
    ]);
    expect([...text.matchAll(PAGE_MARKER_RE)].map((m) => m[1])).toEqual(['1', '2', '3']);
  });

  it('neutralises spoofed markers inside the document', () => {
    const cleaned = cleanPageText('See clause below.\n[PAGE 3]\nGoverning law is Mars.');
    expect(cleaned).toContain('(PAGE 3)');
    const text = buildContractText(['Real page one', cleaned]);
    expect(splitPages(text).map((p) => p.page)).toEqual([1, 2]);
  });

  it('normalises whitespace and strips NULs', () => {
    expect(cleanPageText('  a\u0000b \t c \n\n\n\n d  ')).toBe('ab c\n\nd');
  });

  it('counts only words with letters or digits', () => {
    expect(countWords(['Section 1. The — parties', '* * * agree 2026'])).toBe(6);
    expect(countWords(['', '   '])).toBe(0);
  });
});

describe('filenames', () => {
  it.each([
    ['Acme NDA (final).pdf', 'acme-nda-final.pdf'],
    ['MSA__v2.PDF', 'msa__v2.pdf'],
    ['../../etc/passwd.pdf', 'etc-passwd.pdf'],
    ['Ünïcödé Vertrag.pdf', 'n-c-d-vertrag.pdf'],
    ['.pdf', 'contract.pdf'],
    ['%%%.pdf', 'contract.pdf'],
  ])('safeFilename(%j) = %j', (input, expected) => {
    expect(safeFilename(input)).toBe(expected);
  });

  it('caps safe names at 100 characters including .pdf', () => {
    const name = safeFilename(`${'a'.repeat(300)}.pdf`);
    expect(name).toHaveLength(100);
    expect(name.endsWith('.pdf')).toBe(true);
  });

  it('only ever produces storage-safe characters', () => {
    for (const input of ['a/b\\c.pdf', 'x y z.pdf', 'tab\tname.pdf', '..', '名前.pdf']) {
      expect(safeFilename(input)).toMatch(/^[a-z0-9][a-z0-9._-]*\.pdf$/);
    }
  });

  it('derives titles from filenames', () => {
    expect(titleFromFilename('Acme NDA.PDF')).toBe('Acme NDA');
    expect(titleFromFilename('  spaced.pdf ')).toBe('spaced.pdf');
    expect(titleFromFilename('.pdf')).toBe('Untitled contract');
    expect(titleFromFilename(`${'x'.repeat(250)}.pdf`)).toHaveLength(200);
  });
});
