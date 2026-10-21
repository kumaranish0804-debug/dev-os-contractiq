// `[PAGE N]` markers in contracts.contract_text (Spec 05 §5.7). Pure module: zero imports.

export const PAGE_MARKER_RE = /^\[PAGE (\d+)\]$/gm;

/** Joins per-page text. Empty pages keep their marker so numbering matches the PDF. */
export function buildContractText(pages: string[]): string {
  return pages.map((text, i) => `[PAGE ${i + 1}]\n${text}`).join('\n\n');
}

export function splitPages(contractText: string): { page: number; text: string }[] {
  const parts = contractText.split(/^\[PAGE (\d+)\]$/m); // ['', '1', text1, '2', text2, …]
  const out: { page: number; text: string }[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    out.push({ page: Number(parts[i]), text: (parts[i + 1] ?? '').trim() });
  }
  return out;
}

/** Normalises extracted page text and neutralises spoofed `[PAGE N]` markers in the document. */
export function cleanPageText(s: string): string {
  return s
    .replace(/\u0000/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\[PAGE (\d+)\]/g, '(PAGE $1)')
    .trim();
}

/** Words containing at least one letter or digit (Spec 05 §5.7). */
export function countWords(pages: string[]): number {
  return pages
    .join(' ')
    .split(/\s+/)
    .filter((w) => /[A-Za-z0-9]/.test(w)).length;
}
