'use client';

import { useCallback, useEffect, useState } from 'react';

/** A seconds countdown, e.g. the 60 s "Resend email" cooldown (Spec 04 §4.4). */
export function useCountdown(): { remaining: number; start: (seconds: number) => void } {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setTimeout(() => setRemaining((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);

  const start = useCallback((seconds: number) => setRemaining(seconds), []);
  return { remaining, start };
}
