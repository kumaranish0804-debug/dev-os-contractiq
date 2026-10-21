// Upload filename rules (Spec 02 §2.7, Spec 05 §5.6). Pure module: zero imports.

const TITLE_MAX = 200;
const SAFE_NAME_MAX = 100;

/** Storage-safe name: lower-case, [a-z0-9._-] only, dashes collapsed, ≤ 100 chars, ends in .pdf. */
export function safeFilename(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/\.pdf$/, '')
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  const stem = (base || 'contract').slice(0, SAFE_NAME_MAX - '.pdf'.length).replace(/[-.]+$/, '');
  return `${stem || 'contract'}.pdf`;
}

/** Default contract title: the filename without .pdf, trimmed, ≤ 200 chars. */
export function titleFromFilename(name: string): string {
  const title = name.replace(/\.pdf$/i, '').trim().slice(0, TITLE_MAX).trim();
  return title || 'Untitled contract';
}
