import { AppError } from './errors.ts';
import { createUserClient, type TypedClient } from './supabase.ts';

const BEARER_RE = /^Bearer\s+(\S+)$/i;

/** Verifies the caller's JWT with Supabase Auth. Missing or invalid → UNAUTHENTICATED. */
export async function authenticate(
  req: Request,
): Promise<{ userId: string; userClient: TypedClient }> {
  const token = BEARER_RE.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!token) throw new AppError('UNAUTHENTICATED');

  const userClient = createUserClient(token);
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) throw new AppError('UNAUTHENTICATED');

  return { userId: data.user.id, userClient };
}
