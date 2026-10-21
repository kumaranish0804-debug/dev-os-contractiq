import { normaliseForMatch } from '@shared/text-normalise';

// Source sentence → character range on a page (Spec 08 §8.7). Shared by the text and PDF viewers.

const MAX_WORDS = 40;
const MIN_WORDS = 3;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whitespace/punctuation-tolerant regex for a sentence; null when too short to be meaningful. */
export function buildSentenceRegex(sentence: string): RegExp | null {
  const words = normaliseForMatch(sentence).split(' ').filter(Boolean).slice(0, MAX_WORDS);
  if (words.length < MIN_WORDS) return null;
  // Hyphenated words may be split across a line break in the document ("non-\ndisclosure").
  const body = words.map((w) => escapeRegExp(w).replace(/-/g, '-\\s*')).join('[\\s\\S]{0,3}?\\s*');
  return new RegExp(body, 'i');
}

// Same-length character folding, so indices in the folded text map 1:1 to the original.
const FOLD: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '′': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '‟': '"',
  '″': '"',
  '–': '-',
  '—': '-',
  ' ': ' ',
};
const FOLD_RE = /[‘’‚‛′“”„‟″–— ]/g;

/**
 * PDF text layer: indices of the text items that overlap the sentence's range. Items are joined
 * with single spaces, mirroring how the page text is built for matching (Spec 08 §8.7).
 */
export function matchTextItems(items: { str: string }[], sentence: string | null | undefined): Set<number> {
  const matched = new Set<number>();
  if (!sentence || items.length === 0) return matched;

  const starts: number[] = [];
  let offset = 0;
  for (const item of items) {
    starts.push(offset);
    offset += item.str.length + 1;
  }
  const range = findRange(items.map((i) => i.str).join(' '), sentence);
  if (!range) return matched;

  items.forEach((item, i) => {
    const start = starts[i]!;
    const end = start + item.str.length;
    if (item.str.length > 0 && start < range.end && end > range.start) matched.add(i);
  });
  return matched;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The [start, end) range of `sentence` in `pageText`, or null when it cannot be located. */
export function findRange(pageText: string, sentence: string | null | undefined): { start: number; end: number } | null {
  if (!sentence) return null;
  const regex = buildSentenceRegex(sentence);
  if (!regex) return null;
  // Every folded character is one UTF-16 unit, so indices stay aligned with the original.
  const haystack = pageText.replace(FOLD_RE, (c) => FOLD[c] ?? c);
  const match = regex.exec(haystack);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}
