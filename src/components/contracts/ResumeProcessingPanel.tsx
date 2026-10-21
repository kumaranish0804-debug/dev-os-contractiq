'use client';

import { useEffect } from 'react';
import { ContractTypeSelect } from '@/components/contracts/ContractTypeSelect';
import { TermPreviewCard } from '@/components/contracts/TermPreviewCard';
import { Button } from '@/components/ui/Button';
import { useReviewSessionStore, type ContractType } from '@/stores/review-session-store';

// For an uploaded-but-never-processed contract (Spec 07 §7.1): same preview + custom terms as the
// wizard, with the stored type pre-selected.
export function ResumeProcessingPanel({
  contractType,
  onProcess,
}: {
  contractType: ContractType;
  onProcess: (type: ContractType, customTerms: string[]) => void;
}) {
  const { contractType: selected, customTerms, setContractType, reset } = useReviewSessionStore();

  useEffect(() => {
    setContractType(contractType);
    return reset;
  }, [contractType, setContractType, reset]);

  const type = selected ?? contractType;

  return (
    <div className="flex flex-col gap-10">
      <p className="text-body-lg text-text-secondary">
        This contract was uploaded but hasn&apos;t been analysed yet.
      </p>
      <ContractTypeSelect value={type} onChange={setContractType} />
      <TermPreviewCard contractType={type} locked={false} />
      <Button size="lg" className="self-start" onClick={() => onProcess(type, customTerms)}>
        Process Contract
      </Button>
    </div>
  );
}
