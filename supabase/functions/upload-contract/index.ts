import { createHandler } from '../_shared/handler.ts';
import { RATE_LIMITS } from '../_shared/rate-limit.ts';
import { handleUpload } from './upload.ts';

Deno.serve(
  createHandler(
    { name: 'upload-contract', method: 'POST', rateLimit: RATE_LIMITS.upload },
    (ctx) => handleUpload(ctx),
  ),
);
