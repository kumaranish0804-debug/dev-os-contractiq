'use client';

import { LIMITS } from '@shared/limits';
import { ChatInput } from '@/components/chat/ChatInput';
import { MessageList } from '@/components/chat/MessageList';
import { SuggestedQuestions } from '@/components/chat/SuggestedQuestions';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { useChat } from '@/hooks/use-chat';

/** The input is replaced once a send could no longer fit both messages (Spec 09 §9.3). */
const LIMIT_REACHED_AT = LIMITS.chatSessionMax - 2;

export function ChatPanel({ contractId, contractType }: { contractId: string; contractType: 'NDA' | 'MSA' }) {
  const { history, send, stop, retry, isStreaming } = useChat(contractId, true);

  if (history.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-4">
        <span className="sr-only">Loading conversation…</span>
        <Skeleton className="ml-auto h-10 w-2/3" />
        <Skeleton className="h-24 w-4/5" />
      </div>
    );
  }

  if (history.isError) {
    return (
      <Alert variant="error">
        <span>We couldn&apos;t load this conversation.</span>
        <Button variant="secondary" className="self-start" onClick={() => void history.refetch()}>
          Try again
        </Button>
      </Alert>
    );
  }

  const { messages, message_count: count } = history.data;
  const atLimit = count >= LIMIT_REACHED_AT;

  return (
    <section aria-label="Chat" className="flex h-full min-h-[24rem] flex-col gap-4">
      {messages.length === 0 ? (
        <div className="flex-1">
          <SuggestedQuestions contractType={contractType} disabled={isStreaming} onPick={(q) => void send(q)} />
        </div>
      ) : (
        <MessageList messages={messages} onRetry={retry} />
      )}
      {atLimit ? (
        <p role="status" className="rounded-md border border-border bg-bg-subtle px-3 py-2 text-body-sm text-text-secondary">
          This conversation has reached its limit.
        </p>
      ) : (
        <ChatInput streaming={isStreaming} onSend={(q) => void send(q)} onStop={stop} />
      )}
    </section>
  );
}
