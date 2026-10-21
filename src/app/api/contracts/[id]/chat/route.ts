import { LIMITS } from '@shared/limits';
import { ApiError } from '@/lib/api/api-error';
import { errorResponse, requireUser } from '@/lib/api/route';
import { parseId } from '@/lib/validation/common';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/contracts/[id]/chat — saved conversation, oldest first (Spec 09 §9.4). RLS scopes
// every query to the caller.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseId(params.id);
    const { supabase } = await requireUser();

    const { data: contract, error: contractError } = await supabase
      .from('contracts')
      .select('id, status')
      .eq('id', id)
      .maybeSingle();
    if (contractError) throw new Error(`contracts select failed: ${contractError.message}`);
    if (!contract) throw new ApiError('NOT_FOUND');

    const { data: session, error: sessionError } = await supabase
      .from('chat_sessions')
      .select('id, message_count')
      .eq('contract_id', id)
      .maybeSingle();
    if (sessionError) throw new Error(`chat_sessions select failed: ${sessionError.message}`);

    if (!session) {
      return Response.json({ session_id: null, message_count: 0, messages: [] }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const { data: messages, error: messagesError } = await supabase
      .from('chat_messages')
      .select('id, role, content, cited_pages, status, created_at')
      .eq('session_id', session.id)
      .order('created_at', { ascending: true })
      .limit(LIMITS.chatSessionMax);
    if (messagesError) throw new Error(`chat_messages select failed: ${messagesError.message}`);

    return Response.json(
      { session_id: session.id, message_count: session.message_count, messages: messages ?? [] },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
