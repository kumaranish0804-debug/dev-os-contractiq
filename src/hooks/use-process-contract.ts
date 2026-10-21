'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { ApiError } from '@/lib/api/api-error';
import { callEdge } from '@/lib/api/edge';
import { createClient } from '@/lib/supabase/client';
import { isErrorCode, type ErrorCode } from '@/lib/utils/errors';
import type { ProcessContractBody } from '@/lib/validation/contract';
import type { ProcessingState } from '@/stores/review-session-store';

// Timings from Spec 06 §6.4.
export const PROCESS_TIMINGS = {
  compilingAfterMs: 15_000,
  responseTimeoutMs: 75_000,
  pollIntervalMs: 3_000,
  pollForMs: 60_000,
};

type StatusRow = { status: string; error_code: string | null };

/**
 * Runs process-contract and reports progress through `onStateChange`. Success is whichever comes
 * first: the HTTP 200, or Realtime/polling reporting `completed` (covers dropped connections).
 */
export function useProcessContract({
  onSuccess,
  onStateChange,
}: {
  onSuccess: (contractId: string) => void;
  onStateChange: (state: ProcessingState) => void;
}) {
  const [supabase] = useState(() => createClient());
  const cleanupRef = useRef<(() => void) | null>(null);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const onStateRef = useRef(onStateChange);
  onStateRef.current = onStateChange;
  const setProcessing = useCallback((state: ProcessingState) => onStateRef.current(state), []);

  useEffect(() => () => cleanupRef.current?.(), []);

  const process = useCallback(
    (body: ProcessContractBody) => {
      cleanupRef.current?.();

      const id = body.contract_id;
      const controller = new AbortController();
      const timers: ReturnType<typeof setTimeout>[] = [];
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let channel: RealtimeChannel | null = null;
      let settled = false;

      const cleanup = () => {
        settled = true;
        controller.abort();
        timers.forEach(clearTimeout);
        if (pollTimer) clearInterval(pollTimer);
        if (channel) void supabase.removeChannel(channel);
        cleanupRef.current = null;
      };
      cleanupRef.current = cleanup;

      const succeed = () => {
        if (settled) return;
        cleanup();
        onSuccessRef.current(id);
      };
      const fail = (code: ErrorCode) => {
        if (settled) return;
        cleanup();
        setProcessing({ kind: 'error', code });
      };
      const applyStatus = (row: StatusRow | null) => {
        if (!row) return;
        if (row.status === 'completed') succeed();
        else if (row.status === 'error') fail(isErrorCode(row.error_code) ? row.error_code : 'INTERNAL');
      };

      const startPolling = () => {
        if (settled || pollTimer) return;
        const stopAt = Date.now() + PROCESS_TIMINGS.pollForMs;
        pollTimer = setInterval(async () => {
          if (Date.now() >= stopAt) {
            fail('AI_TIMEOUT');
            return;
          }
          const { data } = await supabase
            .from('contracts')
            .select('status, error_code')
            .eq('id', id)
            .maybeSingle();
          applyStatus(data);
        }, PROCESS_TIMINGS.pollIntervalMs);
      };

      setProcessing({ kind: 'running', step: 2 });
      timers.push(
        setTimeout(() => {
          if (!settled) setProcessing({ kind: 'running', step: 3 });
        }, PROCESS_TIMINGS.compilingAfterMs),
        setTimeout(() => {
          // No response yet: stop waiting on HTTP and check the row instead.
          controller.abort();
          startPolling();
        }, PROCESS_TIMINGS.responseTimeoutMs),
      );

      // Only status/error columns are read from the payload (Spec 02 §2.8).
      channel = supabase
        .channel(`contract-status-${id}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'contracts', filter: `id=eq.${id}` },
          (payload) => applyStatus(payload.new as StatusRow),
        )
        .subscribe();

      callEdge('process-contract', body, { signal: controller.signal })
        .then(succeed)
        .catch((e: unknown) => {
          if (settled) return;
          if (e instanceof DOMException && e.name === 'AbortError') return;
          if (e instanceof ApiError) {
            // Network drop, or a run already in flight: the outcome arrives via Realtime/polling.
            if (e.status === 0 || e.code === 'ALREADY_PROCESSING') {
              startPolling();
              return;
            }
            fail(e.code);
            return;
          }
          fail('INTERNAL');
        });
    },
    [setProcessing, supabase],
  );

  return { process };
}
