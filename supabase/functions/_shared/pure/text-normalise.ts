// Source-sentence verification (Spec 06 §6.6 step 5). Pure module: zero imports.

const PREFIX_MATCH_CHARS = 120;

/** NFKC, lower-case, straight quotes, ASCII dashes, collapsed whitespace, trimmed quote marks. */
export function normaliseForMatch(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'`*]+|["'`*]+$/g, '')
    .trim();
}

/**
 * Finds the page containing `sentence`: the claimed page first, then every page in order.
 * Sentences of 120+ normalised characters also match on their first 120 characters.
 */
export function findSentencePage(
  pages: { page: number; text: string }[],
  sentence: string | null | undefined,
  preferredPage: number | null | undefined,
): { page: number | null; found: boolean } {
  const needle = normaliseForMatch(sentence ?? '');
  if (!needle) return { page: null, found: false };

  const prefix = needle.length >= PREFIX_MATCH_CHARS ? needle.slice(0, PREFIX_MATCH_CHARS) : null;
  const matches = (text: string) => {
    const hay = normaliseForMatch(text);
    return hay.includes(needle) || (prefix !== null && hay.includes(prefix));
  };

  const preferred = pages.find((p) => p.page === preferredPage);
  if (preferred && matches(preferred.text)) return { page: preferred.page, found: true };
  for (const p of pages) {
    if (p !== preferred && matches(p.text)) return { page: p.page, found: true };
  }
  return { page: null, found: false };
}
