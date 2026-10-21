'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { redirectToLogin } from '@/lib/api/http';
import { xhrPost, type XhrResult } from '@/lib/api/xhr';
import { functionsUrl, publicEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/client';
import { isErrorCode, type ErrorCode } from '@/lib/utils/errors';
import { useReviewSessionStore, type ContractType } from '@/stores/review-session-store';
import { toast } from '@/stores/toast-store';

export type UploadContractResponse = {
  contract_id: string;
  page_count: number;
  word_count: number;
  token_count: number;
  file_stored: boolean;
};

class UploadFailed extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
  }
}

function errorCodeOf(result: XhrResult): ErrorCode {
  const code = (result.body as { error?: { code?: unknown } } | null)?.error?.code;
  return isErrorCode(code) ? code : 'INTERNAL';
}

/**
 * Uploads the PDF to the upload-contract Edge Function with progress (Spec 05 §5.8) and
 * writes each state to the review session store. A 401 refreshes the session and retries once.
 * The in-flight request is aborted on unmount or when a new upload starts.
 */
export function useUploadContract() {
  const setUpload = useReviewSessionStore((s) => s.setUpload);
  const [supabase] = useState(() => createClient());
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const upload = useCallback(
    async (file: File, contractType: ContractType) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      const form = new FormData();
      form.set('file', file);
      form.set('contract_type', contractType);

      const send = (accessToken: string) => {
        setUpload({ kind: 'uploading', progress: 0 });
        return xhrPost(`${functionsUrl}/upload-contract`, form, {
          headers: {
            authorization: `Bearer ${accessToken}`,
            apikey: publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          },
          signal: controller.signal,
          onUploadProgress: (fraction) => {
            if (controller.signal.aborted) return;
            setUpload(
              fraction >= 1
                ? { kind: 'extracting' }
                : { kind: 'uploading', progress: Math.round(fraction * 100) },
            );
          },
        });
      };

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          redirectToLogin();
          throw new UploadFailed('UNAUTHENTICATED');
        }

        let result = await send(session.access_token);
        if (result.status === 401) {
          const { data, error } = await supabase.auth.refreshSession();
          if (error || !data.session) {
            redirectToLogin();
            throw new UploadFailed('UNAUTHENTICATED');
          }
          result = await send(data.session.access_token);
          if (result.status === 401) redirectToLogin();
        }

        if (result.status !== 201) throw new UploadFailed(errorCodeOf(result));

        const body = result.body as UploadContractResponse;
        if (controller.signal.aborted) return;
        setUpload({
          kind: 'uploaded',
          contractId: body.contract_id,
          pageCount: body.page_count,
          fileStored: body.file_stored,
        });
        if (!body.file_stored) {
          toast({
            title: "We couldn't store the original PDF",
            description:
              "You'll see a text view of the contract. Analysis is unaffected.",
          });
        }
      } catch (e) {
        if (controller.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
          return;
        }
        setUpload({ kind: 'error', code: e instanceof UploadFailed ? e.code : 'INTERNAL' });
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    },
    [setUpload, supabase],
  );

  return { upload, cancel };
}
