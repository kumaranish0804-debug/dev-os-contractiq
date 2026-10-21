// `[Page N]` citations and `[From conversation]` attributions in chat answers (Spec 09 §9.6).
// Pure module: zero imports.

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

/** Attribution for facts taken from earlier messages (prompt v1.1 HISTORY and BOTH answers). */
export const CONVERSATION_TAG_RE = /\[From (?:the |our )?conversation\]/gi;

export const hasConversationAttribution = (text: string): boolean => new RegExp(CONVERSATION_TAG_RE.source, 'i').test(text);

export type CitationSegment =
  | { type: 'text'; value: string }
  | { type: 'citation'; page: number }
  | { type: 'conversation' };

const ANY_ATTRIBUTION_RE = new RegExp(`${CITATION_RE.source}|${CONVERSATION_TAG_RE.source}`, 'gi');

/** Splits text into plain runs, one segment per cited page, and conversation tags (for chips). */
export function splitCitations(text: string): CitationSegment[] {
  const out: CitationSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(ANY_ATTRIBUTION_RE)) {
    const index = match.index!;
    if (index > last) out.push({ type: 'text', value: text.slice(last, index) });
    if (match[1] === undefined) out.push({ type: 'conversation' });
    else for (const page of expandCitation(match[1])) out.push({ type: 'citation', page });
    last = index + match[0].length;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}
