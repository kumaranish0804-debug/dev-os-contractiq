import { createHandler } from '../_shared/handler.ts';
import { RATE_LIMITS } from '../_shared/rate-limit.ts';
import { handleChat } from './chat.ts';

Deno.serve(
  createHandler({ name: 'chat', method: 'POST', rateLimit: RATE_LIMITS.chat }, (ctx) => handleChat(ctx)),
);
