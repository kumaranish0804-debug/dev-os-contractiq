import { LIMITS } from '@shared/limits';
import type { ErrorCode } from '@/lib/utils/errors';

/** Client-side checks before any network call (Spec 05 §5.5). The server stays authoritative. */
export function validatePdfFile(file: File): ErrorCode | null {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf) return 'UNSUPPORTED_FILE_TYPE';
  if (file.size > LIMITS.maxFileBytes) return 'FILE_TOO_LARGE';
  if (file.size === 0) return 'INVALID_PDF';
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
