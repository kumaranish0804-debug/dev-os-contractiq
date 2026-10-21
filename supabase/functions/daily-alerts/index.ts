import { createPostSlack } from '../_shared/alerts.ts';
import { cronHandler } from '../_shared/cron.ts';
import { createAdminClient } from '../_shared/supabase.ts';
import { runDailyAlerts } from './daily-alerts.ts';

// Daily 08:00 UTC via pg_cron `contractiq-daily-alerts` (Spec 02 §2.9, Spec 11 §11.2).
Deno.serve(
  cronHandler('daily-alerts', Deno.env.get('CRON_SECRET'), () =>
    runDailyAlerts({
      admin: createAdminClient(),
      postSlack: createPostSlack(),
      budgetUsd: Deno.env.get('MONTHLY_OPENAI_BUDGET_USD'),
    }),
  ),
);
