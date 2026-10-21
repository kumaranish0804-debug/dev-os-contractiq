import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ResultsView } from '@/components/contracts/ResultsView';
import { getContractDetail } from '@/lib/data/contracts';
import { createClient } from '@/lib/supabase/server';
import { uuidSchema } from '@/lib/validation/common';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Contract results — ContractIQ' };

// Spec 07 §7.1. Unknown, malformed or other users' ids all render the 404 page.
export default async function ContractPage({ params }: { params: { id: string } }) {
  const id = uuidSchema.safeParse(params.id);
  if (!id.success) notFound();

  const supabase = createClient();
  const detail = await getContractDetail(supabase, id.data);
  if (!detail) notFound();

  // Retention clock (Spec 11): a failed bump must never break the page.
  const { error } = await supabase
    .from('contracts')
    .update({ last_accessed_at: new Date().toISOString() })
    .eq('id', id.data);
  if (error) console.error(JSON.stringify({ level: 'warn', event: 'last_accessed_update_failed', error: error.message }));

  return (
    <main className="flex flex-col px-4 py-8 lg:px-28 lg:py-12">
      <ResultsView initial={detail} />
    </main>
  );
}
