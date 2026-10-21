import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export const middleware = (req: NextRequest) => updateSession(req);

export const config = {
  matcher: ['/dashboard/:path*', '/contracts/:path*', '/login', '/signup'],
};
