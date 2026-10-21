'use client';

import { useEffect, useState } from 'react';

/** True once `active` has stayed true for `afterMs` (US-001's 10 s auth target, Spec 04 §4.6). */
export function useSlowNotice(active: boolean, afterMs = 10_000): boolean {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!active) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), afterMs);
    return () => clearTimeout(timer);
  }, [active, afterMs]);

  return slow;
}
