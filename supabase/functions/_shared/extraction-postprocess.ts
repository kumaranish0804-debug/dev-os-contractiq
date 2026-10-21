import type { RequestedTerm } from './prompt-builder.ts';
import { LIMITS } from './pure/limits.ts';
import { findSentencePage, normaliseForMatch } from './pure/text-normalise.ts';
import type { ExtractionOutput } from './schemas.ts';

// Model output → save_extraction_results rows (Spec 06 §6.6).

export type ExtractedTerm = {
  term_key: string;
  term_name: string;
  value: string | null;
  page_number: number | null;
  confidence_score: number;
  source_sentence: string | null;
  is_custom: boolean;
  sort_order: number;
};

/** Without a verified source sentence a term is unreliable: cap below the 50% "medium" band. */
export const UNVERIFIED_CONFIDENCE_CAP = 49;

/** Accepts 0–1 fractions or 0–100 percentages; anything else is 0. Rounded and clamped. */
export function normaliseConfidence(raw: unknown): number {
  let c = Number(raw);
  if (!Number.isFinite(c)) return 0;
  if (c > 1 && c <= 100) {
    // already a percentage
  } else if (c >= 0 && c <= 1) {
    c *= 100;
  } else {
    c = 0;
  }
  return Math.min(100, Math.max(0, Math.round(c)));
}

function isEmptyValue(value: string | null | undefined): boolean {
  if (value == null) return true;
  const trimmed = value.trim();
  return trimmed === '' || trimmed.toLowerCase() === 'not found';
}

export function postProcess(
  output: ExtractionOutput,
  requested: RequestedTerm[],
  pages: { page: number; text: string }[],
  selectedType: 'NDA' | 'MSA',
): { terms: ExtractedTerm[]; detectedTypeMismatch: boolean } {
  const pageCount = pages.length;

  const terms = requested.map((req): ExtractedTerm => {
    const base = {
      term_key: req.key,
      term_name: req.name,
      is_custom: req.isCustom,
      sort_order: req.sortOrder,
    };
    const m =
      output.terms.find((t) => t.term_key === req.key) ??
      output.terms.find((t) => normaliseForMatch(t.term_name) === normaliseForMatch(req.name)) ??
      null;

    if (!m || isEmptyValue(m.value)) {
      return { ...base, value: null, page_number: null, confidence_score: 0, source_sentence: null };
    }

    const value = m.value!.trim().slice(0, LIMITS.termValueMax);
    let confidence = normaliseConfidence(m.confidence_score);
    const source = m.source_sentence?.trim().slice(0, LIMITS.termValueMax) || null;
    const match = findSentencePage(pages, source, m.page_number);

    let page: number | null;
    if (match.found) {
      page = match.page;
    } else {
      const claimed = m.page_number;
      page =
        typeof claimed === 'number' && Number.isInteger(claimed) && claimed >= 1 && pageCount > 0
          ? Math.min(claimed, pageCount)
          : null;
      confidence = Math.min(confidence, UNVERIFIED_CONFIDENCE_CAP);
    }

    return { ...base, value, page_number: page, confidence_score: confidence, source_sentence: source };
  });

  const detected = output.detected_contract_type;
  return { terms, detectedTypeMismatch: detected !== undefined && detected !== selectedType };
}
