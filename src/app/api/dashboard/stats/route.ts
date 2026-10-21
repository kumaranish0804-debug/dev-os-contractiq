import { errorResponse, requireUser } from '@/lib/api/route';
import { getDashboardSummary } from '@/lib/data/contracts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/dashboard/stats — counts plus the 5 newest contracts (Spec 10 §10.3).
export async function GET() {
  try {
    const { supabase } = await requireUser();
    const summary = await getDashboardSummary(supabase);
    return Response.json(summary, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return errorResponse(e);
  }
}
