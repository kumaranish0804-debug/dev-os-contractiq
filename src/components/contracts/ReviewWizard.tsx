'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ContractTypeSelect } from '@/components/contracts/ContractTypeSelect';
import { PdfDropzone } from '@/components/contracts/PdfDropzone';
import { ProcessingStepper } from '@/components/contracts/ProcessingStepper';
import { TermPreviewCard } from '@/components/contracts/TermPreviewCard';
import { UploadStatus } from '@/components/contracts/UploadStatus';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { useProcessContract } from '@/hooks/use-process-contract';
import { useUploadContract } from '@/hooks/use-upload-contract';
import { validatePdfFile } from '@/lib/validation/upload';
import { useReviewSessionStore } from '@/stores/review-session-store';

// /contracts/new orchestrator: type → PDF → preview/custom terms → process (Specs 05–06).
export function ReviewWizard() {
  const router = useRouter();
  const {
    contractType,
    file,
    upload,
    customTerms,
    processing,
    setContractType,
    setFile,
    setUpload,
    setProcessing,
    clearFile,
    reset,
  } = useReviewSessionStore();
  const { upload: startUpload, cancel } = useUploadContract();
  const { process } = useProcessContract({
    onStateChange: setProcessing,
    onSuccess: (contractId) => {
      reset();
      router.push(`/contracts/${contractId}`);
    },
  });

  // The store is per-visit: clear it when leaving the wizard.
  useEffect(() => reset, [reset]);

  const running = processing.kind === 'running';
  const uploading = upload.kind === 'uploading' || upload.kind === 'extracting';

  function handleFile(next: File) {
    if (!contractType) return;
    const error = validatePdfFile(next);
    setFile(next);
    if (error) {
      setUpload({ kind: 'error', code: error });
      return;
    }
    void startUpload(next, contractType);
  }

  function handleRemove() {
    cancel();
    clearFile();
  }

  function handleProcess() {
    if (upload.kind !== 'uploaded' || !contractType) return;
    process({ contract_id: upload.contractId, contract_type: contractType, custom_terms: customTerms });
  }

  return (
    <div className="flex flex-col gap-10">
      <Alert variant="info" className="md:hidden">
        ContractIQ works best on a desktop browser.
      </Alert>

      <ContractTypeSelect value={contractType} onChange={setContractType} disabled={running} />

      <section aria-labelledby="upload-heading" className="flex flex-col gap-4">
        <h2 id="upload-heading" className="text-body-lg text-text-primary">
          2. Upload the PDF
        </h2>
        {upload.kind === 'uploaded' && file ? (
          <UploadStatus
            fileName={file.name}
            fileSize={file.size}
            pageCount={upload.pageCount}
            onRemove={running ? undefined : handleRemove}
          />
        ) : (
          <PdfDropzone
            disabled={!contractType}
            upload={upload.kind === 'uploaded' ? { kind: 'idle' } : upload}
            onFile={handleFile}
            onReset={handleRemove}
          />
        )}
      </section>

      {contractType ? <TermPreviewCard contractType={contractType} locked={running} /> : null}

      {processing.kind === 'idle' ? (
        <div className="flex flex-col items-start gap-2">
          <Button size="lg" disabled={upload.kind !== 'uploaded'} onClick={handleProcess}>
            {uploading ? 'Waiting for upload…' : 'Process Contract'}
          </Button>
          {upload.kind === 'idle' || upload.kind === 'error' ? (
            <p className="text-body-sm text-text-secondary">Upload a PDF to continue.</p>
          ) : null}
        </div>
      ) : (
        <ProcessingStepper state={processing} onRetry={handleProcess} />
      )}
    </div>
  );
}
