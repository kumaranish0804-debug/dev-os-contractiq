'use client';

import { useDropzone } from 'react-dropzone';
import { AlertCircle, FileUp } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/utils/cn';
import { ERROR_MESSAGES } from '@/lib/utils/errors';
import type { UploadState } from '@/stores/review-session-store';

type Props = {
  disabled: boolean;
  upload: Exclude<UploadState, { kind: 'uploaded' }>;
  onFile: (file: File) => void;
  onReset: () => void;
};

function Progress({ upload }: { upload: Extract<UploadState, { kind: 'uploading' | 'extracting' }> }) {
  const extracting = upload.kind === 'extracting';
  const value = extracting ? 100 : upload.progress;
  const label = extracting ? 'Extracting text…' : `Uploading… ${value}%`;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-bg-primary p-6" aria-live="polite">
      <div className="flex items-center gap-2 text-body-lg text-text-primary">
        <Spinner />
        {label}
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        className="h-2 w-full overflow-hidden rounded-full bg-bg-subtle"
      >
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-base ease-out"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

// Drop or browse for one PDF (Spec 05 §5.3). Client validation happens in the parent's onFile.
export function PdfDropzone({ disabled, upload, onFile, onReset }: Props) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'application/pdf': ['.pdf'] },
    multiple: false,
    disabled,
    // Validate everything ourselves so rejected files get the spec's error copy.
    onDrop: (accepted, rejected) => {
      const file = accepted[0] ?? rejected[0]?.file;
      if (file) onFile(file);
    },
  });

  if (upload.kind === 'uploading' || upload.kind === 'extracting') {
    return <Progress upload={upload} />;
  }

  if (upload.kind === 'error') {
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-4 rounded-lg border border-error-border bg-error-bg p-6"
      >
        <div className="flex items-start gap-2 text-body-lg text-error-text">
          <AlertCircle aria-hidden="true" className="mt-1 size-4 shrink-0" />
          {ERROR_MESSAGES[upload.code]}
        </div>
        <Button variant="secondary" onClick={onReset}>
          Choose another file
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        {...getRootProps({
          'aria-label': 'Upload a PDF contract',
          'aria-disabled': disabled || undefined,
          'aria-describedby': disabled ? 'dropzone-disabled-hint' : undefined,
        })}
        className={cn(
          'flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-4 py-12 text-center transition-colors duration-fast ease-out',
          disabled
            ? 'cursor-not-allowed border-border bg-bg-surface opacity-60'
            : 'cursor-pointer border-border-strong bg-bg-primary hover:bg-bg-subtle',
          isDragActive && 'border-brand bg-brand-subtle',
        )}
      >
        <input {...getInputProps({ 'aria-label': 'Choose a PDF contract to upload' })} />
        <FileUp aria-hidden="true" className="size-8 text-text-secondary" />
        <p className="text-body-lg text-text-primary">
          Drag and drop your PDF here, or <span className="text-brand underline">browse</span>
        </p>
        <p className="text-body-sm text-text-secondary">PDF only · up to 20 pages · 10 MB</p>
      </div>
      {disabled ? (
        <p id="dropzone-disabled-hint" className="text-body-sm text-text-secondary">
          Choose a contract type first.
        </p>
      ) : null}
    </div>
  );
}
