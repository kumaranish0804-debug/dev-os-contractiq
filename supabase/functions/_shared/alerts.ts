// Slack alerts (Spec 11 §11.3). Messages carry aggregate numbers only — never contract content,
// user emails or ids.
import { log } from './logging.ts';

export type PostSlack = (text: string) => Promise<void>;

/** Posts to SLACK_ALERT_WEBHOOK_URL. Without a webhook the alert is logged instead; failures are logged, never thrown. */
export function createPostSlack(
  webhookUrl: string | undefined = Deno.env.get('SLACK_ALERT_WEBHOOK_URL'),
  fetchImpl: typeof fetch = fetch,
): PostSlack {
  return async (text) => {
    if (!webhookUrl) {
      log('warn', { msg: 'slack_webhook_missing', text });
      return;
    }
    try {
      const res = await fetchImpl(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `:rotating_light: ContractIQ — ${text}` }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) log('error', { msg: 'slack_post_failed', status: res.status, text });
    } catch (e) {
      log('error', { msg: 'slack_post_failed', error: e instanceof Error ? e.message : String(e), text });
    }
  };
}
