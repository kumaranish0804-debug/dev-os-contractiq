import { ApiError } from '@/lib/api/api-error';
import { errorResponse, requireUser } from '@/lib/api/route';
import { parseId } from '@/lib/validation/common';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SIGNED_URL_SECONDS = 3600;

// GET /api/contracts/[id]/file-url — 1-hour signed URL for the original PDF (Spec 08 §8.4).
// Uses the user-scoped client, so both the contracts RLS and the storage SELECT policy apply.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseId(params.id);
    const { supabase } = await requireUser();

    const { data: contract, error } = await supabase
      .from('contracts')
      .select('file_path, original_filename')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`contracts select failed: ${error.message}`);
    if (!contract) throw new ApiError('NOT_FOUND');
    if (!contract.file_path) throw new ApiError('FILE_NOT_AVAILABLE');

    const [view, download] = await Promise.all([
      supabase.storage.from('contracts').createSignedUrl(contract.file_path, SIGNED_URL_SECONDS),
      supabase.storage
        .from('contracts')
        .createSignedUrl(contract.file_path, SIGNED_URL_SECONDS, { download: contract.original_filename }),
    ]);
    if (view.error || !view.data?.signedUrl) throw new ApiError('FILE_NOT_AVAILABLE');

    return Response.json(
      {
        url: view.data.signedUrl,
        download_url: download.data?.signedUrl ?? view.data.signedUrl,
        expires_at: new Date(Date.now() + SIGNED_URL_SECONDS * 1000).toISOString(),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
