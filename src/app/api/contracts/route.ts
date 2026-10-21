import { errorResponse, parseBody, requireUser } from '@/lib/api/route';
import { listContracts } from '@/lib/data/contracts';
import { listQuerySchema } from '@/lib/validation/contract-list';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/contracts?sort&dir&limit&offset — the caller's contracts (Spec 10 §10.3).
export async function GET(request: Request) {
  try {
    const query = parseBody(listQuerySchema, Object.fromEntries(new URL(request.url).searchParams));
    const { supabase } = await requireUser();
    const page = await listContracts(supabase, query);
    return Response.json(page, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return errorResponse(e);
  }
}
