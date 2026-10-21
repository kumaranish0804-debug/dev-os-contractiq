'use client';

import dynamic from 'next/dynamic';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { FeedbackWidget } from '@/components/key-terms/FeedbackWidget';
import { KeyTermsPanel } from '@/components/key-terms/KeyTermsPanel';
import { Skeleton } from '@/components/ui/Skeleton';
import { ContractViewer } from '@/components/viewer/ContractViewer';
import type { ContractDetail } from '@/lib/data/contracts';
import { cn } from '@/lib/utils/cn';
import { useViewerStore } from '@/stores/viewer-store';

// Chat (react-markdown) is only downloaded when the Chat tab is opened.
const ChatPanel = dynamic(() => import('@/components/chat/ChatPanel').then((m) => m.ChatPanel), {
  loading: () => <Skeleton className="h-40 w-full" />,
});

type Tab = 'document' | 'terms' | 'chat';

const MOBILE_QUERY = '(max-width: 767px)';
const isMobile = () => typeof window !== 'undefined' && window.matchMedia?.(MOBILE_QUERY).matches === true;

const triggerClass =
  'border-b-2 border-transparent px-3 py-2 text-body-lg text-text-secondary transition-colors duration-fast ease-out hover:text-text-primary data-[state=active]:border-brand data-[state=active]:text-text-primary';

function parseTab(value: string | null): Tab {
  return value === 'chat' || value === 'document' ? value : 'terms';
}

/**
 * Document + tabs (Spec 07 §7.2): side by side ≥1024px, stacked 768–1023px, and three tabs
 * (Document / Key Terms / Chat) below 768px. The tab lives in the URL (?tab=terms|chat).
 */
export function ResultsPanels({ detail }: { detail: ContractDetail }) {
  const { contract, key_terms: terms } = detail;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = parseTab(searchParams.get('tab'));
  // "Document" is a tab only on small screens; elsewhere the viewer is always visible.
  const tab: Tab = requested === 'document' && !isMobile() ? 'terms' : requested;

  function setTab(next: Tab) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'terms') params.delete('tab');
    else params.set('tab', next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  // On mobile, a user-initiated page link or citation switches to the Document tab.
  const revealNonce = useViewerStore((s) => s.revealNonce);
  const lastReveal = useRef(revealNonce);
  useEffect(() => {
    if (revealNonce === lastReveal.current) return;
    lastReveal.current = revealNonce;
    if (isMobile() && tab !== 'document') setTab('document');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealNonce]);

  return (
    <Tabs.Root value={tab} onValueChange={(v) => setTab(v as Tab)} className="flex flex-col gap-6 lg:grid lg:grid-cols-[55fr_45fr]">
      <div className={cn('h-[60vh] lg:h-[calc(100vh-16rem)]', tab === 'document' ? 'block' : 'hidden md:block')}>
        <ContractViewer
          contractId={contract.id}
          hasFile={contract.has_file}
          fileDeletedAt={contract.file_deleted_at}
          originalFilename={contract.original_filename}
          contractText={contract.contract_text}
          pageCount={contract.page_count}
        />
      </div>

      <div className="flex flex-col rounded-lg border border-border bg-bg-primary lg:h-[calc(100vh-16rem)]">
        <Tabs.List aria-label="Results" className="flex gap-2 border-b border-border px-4">
          <Tabs.Trigger value="document" className={cn(triggerClass, 'md:hidden')}>
            Document
          </Tabs.Trigger>
          <Tabs.Trigger value="terms" className={triggerClass}>
            Key Terms
          </Tabs.Trigger>
          <Tabs.Trigger value="chat" className={triggerClass}>
            Chat
          </Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content
          value="terms"
          className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6 focus-visible:outline-none data-[state=inactive]:hidden"
        >
          <KeyTermsPanel contractId={contract.id} contractType={contract.contract_type} terms={terms} />
          <FeedbackWidget contractId={contract.id} feedback={detail.feedback} />
        </Tabs.Content>
        <Tabs.Content value="chat" className="min-h-0 flex-1 p-6 focus-visible:outline-none">
          <ChatPanel contractId={contract.id} contractType={contract.contract_type} />
        </Tabs.Content>
        {/* The Document tab's content is the viewer above; this keeps Radix's tab/panel pairing. */}
        <Tabs.Content value="document" className="hidden" />
      </div>
    </Tabs.Root>
  );
}
