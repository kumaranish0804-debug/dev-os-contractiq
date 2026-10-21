import { ApiError } from '@/lib/api/api-error';
import { errorResponse, requireUser } from '@/lib/api/route';
import { parseId } from '@/lib/validation/common';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/contracts/[id]/complete — "Mark review complete" (Spec 07 §7.7, North Star).
 * Idempotent: the first call stamps review_completed_at; later calls return the same value.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseId(params.id);
    const { supabase } = await requireUser();

    const { data: contract, error: lookupError } = await supabase
      .from('contracts')
      .select('status, review_completed_at')
      .eq('id', id)
      .maybeSingle();
    if (lookupError) throw new Error(`contract lookup failed: ${lookupError.message}`);
    if (!contract) throw new ApiError('NOT_FOUND');
    if (contract.review_completed_at) return Response.json({ review_completed_at: contract.review_completed_at });
    if (contract.status !== 'completed') throw new ApiError('CONTRACT_NOT_READY');

    const { data, error } = await supabase
      .from('contracts')
      .update({ review_completed_at: new Date().toISOString() })
      .eq('id', id)
      .is('review_completed_at', null)
      .select('review_completed_at')
      .maybeSingle();
    if (error) throw new Error(`review complete failed: ${error.message}`);
    if (data?.review_completed_at) return Response.json({ review_completed_at: data.review_completed_at });

    // Another request stamped it between the lookup and the update: return that value.
    const { data: current, error: rereadError } = await supabase
      .from('contracts')
      .select('review_completed_at')
      .eq('id', id)
      .maybeSingle();
    if (rereadError) throw new Error(`contract reread failed: ${rereadError.message}`);
    if (!current?.review_completed_at) throw new ApiError('NOT_FOUND');
    return Response.json({ review_completed_at: current.review_completed_at });
  } catch (e) {
    return errorResponse(e);
  }
}
