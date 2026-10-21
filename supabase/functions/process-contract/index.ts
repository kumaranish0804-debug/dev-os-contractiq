import { createHandler } from '../_shared/handler.ts';
import { RATE_LIMITS } from '../_shared/rate-limit.ts';
import { handleProcess } from './process.ts';

Deno.serve(
  createHandler(
    { name: 'process-contract', method: 'POST', rateLimit: RATE_LIMITS.process },
    (ctx) => handleProcess(ctx),
  ),
);
