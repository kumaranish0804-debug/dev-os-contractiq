import { extractText, getDocumentProxy } from 'unpdf';
import { encode } from 'gpt-tokenizer/model/gpt-4o';
import { AppError } from './errors.ts';
import { LIMITS } from './pure/limits.ts';
import { buildContractText, cleanPageText, countWords } from './pure/page-markers.ts';

export type ExtractedPdf = {
  pageCount: number;
  pages: string[];
  contractText: string;
  wordCount: number;
};

/**
 * PDF bytes → per-page text with `[PAGE N]` markers (Spec 05 §5.7).
 * Throws PDF_PASSWORD_PROTECTED, INVALID_PDF or TOO_MANY_PAGES.
 */
export async function extractPdf(bytes: Uint8Array): Promise<ExtractedPdf> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(bytes);
  } catch (e) {
    const name = (e as { name?: unknown } | null)?.name;
    throw new AppError(name === 'PasswordException' ? 'PDF_PASSWORD_PROTECTED' : 'INVALID_PDF', {
      cause: e,
    });
  }

  try {
    if (pdf.numPages > LIMITS.maxPages) throw new AppError('TOO_MANY_PAGES');

    let raw: string[];
    try {
      ({ text: raw } = await extractText(pdf, { mergePages: false }));
    } catch (e) {
      throw new AppError('INVALID_PDF', { cause: e });
    }

    const pages = raw.map(cleanPageText);
    return {
      pageCount: pdf.numPages,
      pages,
      contractText: buildContractText(pages),
      wordCount: countWords(pages),
    };
  } finally {
    await pdf.destroy().catch(() => {});
  }
}

/** o200k token count — the encoding used by gpt-4o and gpt-4o-mini. */
export function countTokens(text: string): number {
  return encode(text).length;
}
