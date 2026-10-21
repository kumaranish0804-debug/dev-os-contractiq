import { ApiError } from '@/lib/api/api-error';
import { errorResponse, requireUser } from '@/lib/api/route';
import { getContractDetail } from '@/lib/data/contracts';
import { parseId } from '@/lib/validation/common';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/contracts/[id] — contract, key terms, custom terms and feedback (Spec 07 §7.8).
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseId(params.id);
    const { supabase } = await requireUser();
    const detail = await getContractDetail(supabase, id);
    if (!detail) throw new ApiError('NOT_FOUND');
    return Response.json(detail, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * DELETE /api/contracts/[id] (Spec 10 §10.6). Both steps use the user-scoped client, so the
 * storage and table policies limit them to the owner; FK cascades remove terms, chat and feedback.
 */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const requestId = crypto.randomUUID();
  try {
    const id = parseId(params.id);
    const { supabase } = await requireUser();

    const { data: contract, error: readError } = await supabase
      .from('contracts')
      .select('id, file_path')
      .eq('id', id)
      .maybeSingle();
    if (readError) throw new Error(`contract lookup failed: ${readError.message}`);
    if (!contract) throw new ApiError('NOT_FOUND');

    if (contract.file_path) {
      // A failed file removal doesn't block the delete: retention clears orphans within 90 days.
      const { error: storageError } = await supabase.storage.from('contracts').remove([contract.file_path]);
      if (storageError) {
        console.error(
          JSON.stringify({ level: 'error', requestId, route: 'DELETE /api/contracts/[id]', contractId: id, error: storageError.message }),
        );
      }
    }

    const { error: deleteError, count } = await supabase.from('contracts').delete({ count: 'exact' }).eq('id', id);
    if (deleteError) throw new Error(`contract delete failed: ${deleteError.message}`);
    if (count === 0) throw new ApiError('NOT_FOUND');

    return new Response(null, { status: 204, headers: { 'x-request-id': requestId } });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
