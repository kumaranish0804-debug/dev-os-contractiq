import { createPostSlack } from '../_shared/alerts.ts';
import { cronHandler } from '../_shared/cron.ts';
import { createAdminClient } from '../_shared/supabase.ts';
import { runRetention } from './retention.ts';

// Daily 03:00 UTC via pg_cron `contractiq-retention-cleanup` (Spec 02 §2.9, Spec 11 §11.1).
Deno.serve(
  cronHandler('retention-cleanup', Deno.env.get('CRON_SECRET'), () =>
    runRetention({ admin: createAdminClient(), postSlack: createPostSlack() }),
  ),
);
