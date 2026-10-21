import { CheckCircle2, FileText } from 'lucide-react';
import { formatBytes } from '@/lib/validation/upload';

// Uploaded file summary with "Remove" (Spec 05 §5.3). Remove keeps the contract on the
// dashboard as "Not processed" — it never deletes (Spec 05 §5.8).
export function UploadStatus({
  fileName,
  fileSize,
  pageCount,
  onRemove,
}: {
  fileName: string;
  fileSize: number;
  pageCount: number;
  /** Omit to hide Remove (e.g. while the contract is being processed). */
  onRemove?: () => void;
}) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-success-border bg-bg-primary p-4">
      <FileText aria-hidden="true" className="size-8 shrink-0 text-text-secondary" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-body-lg text-text-primary" title={fileName}>
          {fileName}
        </span>
        <span className="flex items-center gap-1 text-body-sm text-success-text">
          <CheckCircle2 aria-hidden="true" className="size-4" />
          Uploaded · {pageCount} {pageCount === 1 ? 'page' : 'pages'} · {formatBytes(fileSize)}
        </span>
      </div>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${fileName}`}
          className="rounded-sm px-2 py-1 text-body-sm text-brand underline transition-colors duration-fast ease-out hover:bg-bg-subtle"
        >
          Remove
        </button>
      ) : null}
    </div>
  );
}
