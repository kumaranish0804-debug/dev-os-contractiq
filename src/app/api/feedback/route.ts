import { ApiError } from '@/lib/api/api-error';
import { errorResponse, parseBody, readJson, requireUser } from '@/lib/api/route';
import { feedbackSchema } from '@/lib/validation/feedback';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FEEDBACK_COLUMNS = 'id, rating, comment, updated_at' as const;
const UNIQUE_VIOLATION = '23505';

/**
 * POST /api/feedback — one rating per user per contract (Spec 07 §7.6).
 * Update-or-insert rather than `upsert`: ON CONFLICT DO UPDATE needs UPDATE on every inserted
 * column, but clients are only granted UPDATE (rating, comment), so PostgREST upserts are denied.
 */
export async function POST(request: Request) {
  try {
    const { contract_id, rating, comment } = parseBody(feedbackSchema, await readJson(request));
    const { supabase, user } = await requireUser();

    // RLS: only the owner can see the contract.
    const { data: contract, error: lookupError } = await supabase
      .from('contracts')
      .select('id')
      .eq('id', contract_id)
      .maybeSingle();
    if (lookupError) throw new Error(`contract lookup failed: ${lookupError.message}`);
    if (!contract) throw new ApiError('NOT_FOUND');

    const update = () =>
      supabase
        .from('user_feedback')
        .update({ rating, comment })
        .eq('contract_id', contract_id)
        .eq('user_id', user.id)
        .select(FEEDBACK_COLUMNS)
        .maybeSingle();

    let { data, error } = await update();
    if (!error && !data) {
      ({ data, error } = await supabase
        .from('user_feedback')
        .insert({ user_id: user.id, contract_id, rating, comment })
        .select(FEEDBACK_COLUMNS)
        .single());
      // A concurrent submit inserted first: apply this one on top.
      if (error?.code === UNIQUE_VIOLATION) ({ data, error } = await update());
    }
    if (error) throw new Error(`feedback save failed: ${error.message}`);
    if (!data) throw new ApiError('NOT_FOUND');

    return Response.json({ feedback: data });
  } catch (e) {
    return errorResponse(e);
  }
}
