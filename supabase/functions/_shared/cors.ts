import {
  CORS_ALLOW_HEADERS,
  CORS_ALLOW_METHODS,
  matchCorsOrigin,
  parseAllowedOrigins,
} from './pure/request-rules.ts';

/** CORS headers for a request (Spec 03 §3.5). Unknown origins get no Allow-Origin header. */
export function corsHeaders(req: Request): Record<string, string> {
  const allowed = parseAllowedOrigins(Deno.env.get('ALLOWED_ORIGINS'));
  const origin = matchCorsOrigin(req.headers.get('origin'), allowed);

  const headers: Record<string, string> = {
    Vary: 'Origin',
    'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
    'Access-Control-Allow-Methods': CORS_ALLOW_METHODS,
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}
