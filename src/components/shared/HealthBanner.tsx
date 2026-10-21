'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Manual incident notice (Spec 11 §11.7 runbook): set this to the incident message and deploy;
 * clear it and redeploy to remove it. Shown as a warning banner on every app page.
 */
export const MANUAL_NOTICE = '';

export const OUTAGE_MESSAGE =
  'ContractIQ is having trouble connecting. Your data is safe — some features may be unavailable for a few minutes.';

const POLL_MS = 60_000;
/** One blip isn't an outage: show the banner after two failed checks in a row. */
const FAILURES_BEFORE_BANNER = 2;

async function healthy(): Promise<boolean> {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Checks /api/health on mount and every 60 s while the tab is visible (Spec 11 §11.4), and shows
 * an outage banner after two consecutive failures. Hides again on the next healthy check.
 */
export function HealthBanner({ manualNotice = MANUAL_NOTICE }: { manualNotice?: string }) {
  const [down, setDown] = useState(false);

  useEffect(() => {
    let failures = 0;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const check = async () => {
      const ok = await healthy();
      if (cancelled) return;
      failures = ok ? 0 : failures + 1;
      setDown(failures >= FAILURES_BEFORE_BANNER);
    };
    const start = () => {
      if (timer) return;
      timer = setInterval(() => void check(), POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void check();
        start();
      } else {
        stop();
      }
    };

    void check();
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  if (!down && !manualNotice) return null;
  return (
    <div className="flex flex-col">
      {manualNotice ? (
        <div role="status" className="flex items-start gap-2 border-b border-warning-border bg-warning-bg px-4 py-3 text-body-lg text-warning-text lg:px-28">
          <AlertTriangle aria-hidden="true" className="mt-1 size-4 shrink-0" />
          <p>{manualNotice}</p>
        </div>
      ) : null}
      {down ? (
        <div role="alert" className="flex items-start gap-2 border-b border-error-border bg-error-bg px-4 py-3 text-body-lg text-error-text lg:px-28">
          <AlertTriangle aria-hidden="true" className="mt-1 size-4 shrink-0" />
          <p>{OUTAGE_MESSAGE}</p>
        </div>
      ) : null}
    </div>
  );
}
