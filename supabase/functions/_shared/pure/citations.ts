// `[Page N]` citations in chat answers (Spec 09 §9.6). Pure module: zero imports.

export const CITATION_RE = /\[Pages?\s+(\d+(?:\s*(?:,|and|&|-|–)\s*\d+)*)\]/gi;

const MAX_RANGE = 50;

/** Pages referenced by one citation body, e.g. "3-5" → 3,4,5 and "3, 7 and 9" → 3,7,9. */
export function expandCitation(body: string): number[] {
  const pages: number[] = [];
  const parts = body.split(/\s*(?:,|and|&)\s*/i);
  for (const part of parts) {
    const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(part.trim());
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (to >= from && to - from <= MAX_RANGE) for (let p = from; p <= to; p++) pages.push(p);
      continue;
    }
    const n = Number(part.trim());
    if (Number.isInteger(n)) pages.push(n);
  }
  return pages;
}

/** Unique, ascending pages cited in `text`, limited to 1..pageCount. */
export function parseCitations(text: string, pageCount: number): number[] {
  const pages = new Set<number>();
  for (const match of text.matchAll(CITATION_RE)) {
    for (const p of expandCitation(match[1]!)) if (p >= 1 && p <= pageCount) pages.add(p);
  }
  return [...pages].sort((a, b) => a - b);
}

export type CitationSegment = { type: 'text'; value: string } | { type: 'citation'; page: number };

/** Splits text into plain runs and one citation segment per cited page (for rendering chips). */
export function splitCitations(text: string): CitationSegment[] {
  const out: CitationSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(CITATION_RE)) {
    const index = match.index!;
    if (index > last) out.push({ type: 'text', value: text.slice(last, index) });
    for (const page of expandCitation(match[1]!)) out.push({ type: 'citation', page });
    last = index + match[0].length;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}
