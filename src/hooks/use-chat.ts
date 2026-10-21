'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LIMITS } from '@shared/limits';
import type { QueryType } from '@shared/query-classifier';
import { ApiError } from '@/lib/api/api-error';
import { callEdgeRaw } from '@/lib/api/edge';
import { apiFetch } from '@/lib/api/http';
import { readSse } from '@/lib/api/sse';
import { chatKey } from '@/lib/query-keys';
import { isErrorCode, type ErrorCode } from '@/lib/utils/errors';
import { toast } from '@/stores/toast-store';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  cited_pages: number[];
  status: 'complete' | 'error';
  /** Where the answer came from (the question's classification); null on rows saved without one. */
  query_type: QueryType | null;
  created_at: string;
  /** Client-only state for the in-flight answer. */
  streaming?: boolean;
  stopped?: boolean;
  errorCode?: ErrorCode;
  /** The question an assistant message answers (for Retry). */
  question?: string;
};

export type ChatHistory = { session_id: string | null; message_count: number; messages: ChatMessage[] };


let tempId = 0;

const isQueryType = (v: unknown): v is QueryType => v === 'contract' || v === 'history' || v === 'both';

/**
 * History (`['chat', id]`, never stale — kept current locally) plus streaming send/stop
 * (Spec 09 §9.7). Uses callEdgeRaw, so 401 refresh/retry matches the other functions.
 */
export function useChat(contractId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const key = chatKey(contractId);
  const controllerRef = useRef<AbortController | null>(null);
  const [isStreaming, setStreaming] = useState(false);

  const history = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<ChatHistory>(`/api/contracts/${contractId}/chat`),
    enabled,
    staleTime: Infinity,
  });

  useEffect(() => () => controllerRef.current?.abort(), []);

  const update = useCallback(
    (fn: (h: ChatHistory) => ChatHistory) =>
      queryClient.setQueryData<ChatHistory>(key, (h) => fn(h ?? { session_id: null, message_count: 0, messages: [] })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, contractId],
  );
  const patchMessage = useCallback(
    (id: string, patch: Partial<ChatMessage> | ((m: ChatMessage) => Partial<ChatMessage>)) =>
      update((h) => ({
        ...h,
        messages: h.messages.map((m) => (m.id === id ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m)),
      })),
    [update],
  );

  const send = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || controllerRef.current) return;

      const now = new Date().toISOString();
      const userId = `temp-user-${++tempId}`;
      let assistantId = `temp-assistant-${tempId}`;
      update((h) => ({
        ...h,
        messages: [
          ...h.messages,
          { id: userId, role: 'user', content: text, cited_pages: [], status: 'complete', query_type: null, created_at: now },
          { id: assistantId, role: 'assistant', content: '', cited_pages: [], status: 'complete', query_type: null, created_at: now, streaming: true, question: text },
        ],
      }));

      const controller = new AbortController();
      controllerRef.current = controller;
      setStreaming(true);

      const fail = (code: ErrorCode) =>
        patchMessage(assistantId, { streaming: false, status: 'error', errorCode: code });

      try {
        const res = await callEdgeRaw('chat', { contract_id: contractId, message: text }, { signal: controller.signal });
        for await (const { event, data } of readSse(res, controller.signal)) {
          const payload = data as Record<string, unknown>;
          if (event === 'meta') {
            const realId = String(payload.user_message_id);
            const queryType = isQueryType(payload.query_type) ? payload.query_type : null;
            patchMessage(userId, { id: realId, query_type: queryType });
            patchMessage(assistantId, { query_type: queryType });
          } else if (event === 'delta') {
            patchMessage(assistantId, (m) => ({ content: m.content + String(payload.text ?? '') }));
          } else if (event === 'done') {
            const doneId = payload.message_id ? String(payload.message_id) : assistantId;
            patchMessage(assistantId, {
              id: doneId,
              streaming: false,
              cited_pages: Array.isArray(payload.cited_pages) ? (payload.cited_pages as number[]) : [],
            });
            assistantId = doneId;
            update((h) => ({ ...h, message_count: h.message_count + 2 }));
          } else if (event === 'error') {
            fail(isErrorCode(payload.code) ? payload.code : 'AI_UNAVAILABLE');
          }
        }
      } catch (e) {
        if (controller.signal.aborted) {
          patchMessage(assistantId, { streaming: false, stopped: true });
        } else if (e instanceof ApiError) {
          fail(e.code);
          if (e.code === 'NOT_FOUND') {
            toast({ variant: 'error', title: 'This contract no longer exists.' });
            router.replace('/dashboard');
          } else if (e.code === 'CHAT_LIMIT_REACHED') {
            update((h) => ({ ...h, message_count: LIMITS.chatSessionMax }));
          }
        } else {
          fail('AI_UNAVAILABLE');
        }
      } finally {
        // A stream that ends without done/error must not spin forever: Stop keeps the partial,
        // a dropped connection becomes a retryable error.
        patchMessage(assistantId, (m) =>
          !m.streaming
            ? {}
            : controller.signal.aborted
              ? { streaming: false, stopped: true }
              : { streaming: false, status: 'error', errorCode: 'AI_UNAVAILABLE' },
        );
        controllerRef.current = null;
        setStreaming(false);
      }
    },
    [contractId, patchMessage, router, update],
  );

  const stop = useCallback(() => controllerRef.current?.abort(), []);

  /** Drops the failed exchange from view and asks the same question again. */
  const retry = useCallback(
    (assistantMessageId: string) => {
      const messages = queryClient.getQueryData<ChatHistory>(key)?.messages ?? [];
      const index = messages.findIndex((m) => m.id === assistantMessageId);
      const question = messages[index]?.question;
      if (index < 0 || !question) return;
      update((h) => ({ ...h, messages: h.messages.filter((_, i) => i !== index && i !== index - 1) }));
      void send(question);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, contractId, send, update],
  );

  return { history, send, stop, retry, isStreaming };
}
