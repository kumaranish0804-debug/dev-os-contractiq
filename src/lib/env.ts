import { z } from 'zod';

// Only NEXT_PUBLIC_ values are read by Next.js runtime code (Spec 01 §1.8).
// Each variable is referenced literally so Next.js inlines it into the client bundle.
const publicSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
});

const parsed = publicSchema.safeParse({
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});

if (!parsed.success) {
  const missing = Object.keys(parsed.error.flatten().fieldErrors).join(', ');
  throw new Error(`Invalid or missing environment variables: ${missing}. Copy .env.example to .env.local and fill them in.`);
}

export const publicEnv = parsed.data;
export const functionsUrl = `${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/functions/v1`;
