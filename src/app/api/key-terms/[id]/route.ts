import { ApiError } from '@/lib/api/api-error';
import { errorResponse, parseBody, readJson, requireUser } from '@/lib/api/route';
import { KEY_TERM_COLUMNS } from '@/lib/data/contracts';
import { parseId } from '@/lib/validation/common';
import { keyTermPatchSchema } from '@/lib/validation/key-term';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// PATCH /api/key-terms/[id] — inline edit (Spec 07 §7.5). RLS limits this to the caller's rows
// and the column grant to `value`; the DB trigger maintains is_edited/edited_at/original_value.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseId(params.id);
    const { supabase } = await requireUser();
    const { value } = parseBody(keyTermPatchSchema, await readJson(request));

    const { data, error } = await supabase
      .from('key_terms')
      .update({ value })
      .eq('id', id)
      .select(KEY_TERM_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(`key_terms update failed: ${error.message}`);
    if (!data) throw new ApiError('NOT_FOUND');

    return Response.json({ key_term: data });
  } catch (e) {
    return errorResponse(e);
  }
}
