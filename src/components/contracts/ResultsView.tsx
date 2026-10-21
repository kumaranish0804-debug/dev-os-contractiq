'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ProcessingStepper } from '@/components/contracts/ProcessingStepper';
import { ResultsHeader } from '@/components/contracts/ResultsHeader';
import { ResultsPanels } from '@/components/contracts/ResultsPanels';
import { ResumeProcessingPanel } from '@/components/contracts/ResumeProcessingPanel';
import { TypeMismatchBanner } from '@/components/contracts/TypeMismatchBanner';
import { ErrorState } from '@/components/shared/ErrorState';
import { LegalDisclaimer } from '@/components/shared/LegalDisclaimer';
import { contractKey, useContract } from '@/hooks/use-contract';
import { useProcessContract } from '@/hooks/use-process-contract';
import type { ContractDetail } from '@/lib/data/contracts';
import { ERROR_MESSAGES, isErrorCode } from '@/lib/utils/errors';
import type { ContractType, ProcessingState } from '@/stores/review-session-store';
import { useViewerStore } from '@/stores/viewer-store';

// The results page body, switching on contract status (Spec 07 §7.1).
export function ResultsView({ initial }: { initial: ContractDetail }) {
  const id = initial.contract.id;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data } = useContract(id, initial);
  const { contract, key_terms: terms, custom_terms: customTerms } = data;

  const [run, setRun] = useState<ProcessingState>({ kind: 'idle' });
  const lastRun = useRef<{ type: ContractType; customTerms: string[] } | null>(null);
  const { process } = useProcessContract({
    onStateChange: setRun,
    onSuccess: () => {
      setRun({ kind: 'idle' });
      void queryClient.invalidateQueries({ queryKey: contractKey(id) });
    },
  });

  // Clear navigation state when leaving this contract. Not on mount: child effects (the
  // low-confidence auto-focus) run before this one and must not be wiped.
  const resetViewer = useViewerStore((s) => s.reset);
  useEffect(() => resetViewer, [id, resetViewer]);

  function startRun(type: ContractType, terms: string[]) {
    lastRun.current = { type, customTerms: terms };
    process({ contract_id: id, contract_type: type, custom_terms: terms });
  }

  const editedCount = terms.filter((t) => t.is_edited).length;

  let body: React.ReactNode;
  if (run.kind !== 'idle') {
    body = (
      <ProcessingStepper
        state={run}
        onRetry={() => lastRun.current && startRun(lastRun.current.type, lastRun.current.customTerms)}
      />
    );
  } else if (contract.status === 'uploaded') {
    body = <ResumeProcessingPanel contractType={contract.contract_type} onProcess={startRun} />;
  } else if (contract.status === 'processing') {
    body = <ProcessingStepper state={{ kind: 'running', step: 2 }} onRetry={() => undefined} />;
  } else if (contract.status === 'error') {
    const code = isErrorCode(contract.error_code) ? contract.error_code : 'INTERNAL';
    body = (
      <ErrorState
        title="We couldn't analyse this contract"
        message={ERROR_MESSAGES[code]}
        onRetry={() => startRun(contract.contract_type, customTerms)}
      />
    );
  } else {
    body = (
      <div className="flex flex-col gap-6">
        <LegalDisclaimer />
        {contract.detected_type_mismatch ? (
          <TypeMismatchBanner
            contractId={id}
            selected={contract.contract_type}
            editedCount={editedCount}
            onRerun={(type) => startRun(type, customTerms)}
          />
        ) : null}
        <ResultsPanels detail={data} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ResultsHeader
        contractId={id}
        title={contract.title}
        contractType={contract.contract_type}
        editedCount={editedCount}
        reviewCompletedAt={contract.review_completed_at}
        canCompleteReview={contract.status === 'completed' && run.kind === 'idle'}
        onRerun={() => startRun(contract.contract_type, customTerms)}
        onDeleted={() => router.replace('/dashboard')}
      />
      {body}
    </div>
  );
}
