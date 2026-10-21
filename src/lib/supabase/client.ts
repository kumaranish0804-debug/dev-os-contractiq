import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database.types';
import { publicEnv } from '@/lib/env';

export const createClient = () =>
  createBrowserClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
