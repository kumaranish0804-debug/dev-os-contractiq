import type { Metadata } from 'next';
import { ReviewWizard } from '@/components/contracts/ReviewWizard';

export const metadata: Metadata = { title: 'Review a contract — ContractIQ' };

// Auth is enforced by middleware and the (app) layout.
export default function NewContractPage() {
  return (
    <main className="flex flex-col gap-10 px-4 py-8 lg:px-28 lg:py-24">
      <header className="flex flex-col gap-2">
        <h1 className="text-h5 text-text-primary">Review a contract</h1>
        <p className="text-body-sm text-text-secondary">
          Upload an NDA or MSA (PDF, up to 20 pages / 10 MB).
        </p>
      </header>
      <ReviewWizard />
    </main>
  );
}
