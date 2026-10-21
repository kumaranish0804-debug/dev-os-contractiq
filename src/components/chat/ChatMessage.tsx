'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import { AlertCircle, AlertTriangle, FileText, MessagesSquare } from 'lucide-react';
import { hasConversationAttribution } from '@shared/citations';
import { NOT_FOUND_IN_CONVERSATION, NOT_FOUND_IN_DOCUMENT } from '@shared/prompts';
import type { QueryType } from '@shared/query-classifier';
import { CitationChip, ConversationChip } from '@/components/chat/CitationChip';
import { Button } from '@/components/ui/Button';
import type { ChatMessage as Message } from '@/hooks/use-chat';
import { remarkCitations } from '@/lib/chat/remark-citations';
import { cn } from '@/lib/utils/cn';
import { ERROR_MESSAGES } from '@/lib/utils/errors';

// Safe subset only: no links, images, headings or raw HTML (Spec 09 §9.3).
const ALLOWED = ['p', 'strong', 'em', 'ul', 'ol', 'li', 'br', 'code', 'cite'];

const components: Components = {
  cite: ({ node }) => {
    if (node?.properties?.dataSource === 'conversation') return <ConversationChip />;
    const page = Number(node?.properties?.dataPage);
    return Number.isInteger(page) ? <CitationChip page={page} /> : null;
  },
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal pl-5 last:mb-0">{children}</ol>,
  code: ({ children }) => <code className="rounded-sm bg-bg-subtle px-1">{children}</code>,
};

const NOT_FOUND = new Set([NOT_FOUND_IN_DOCUMENT, NOT_FOUND_IN_CONVERSATION]);

const SOURCES: Record<QueryType, { label: string; icons: (typeof FileText)[] }> = {
  contract: { label: 'From the contract', icons: [FileText] },
  history: { label: 'From our conversation', icons: [MessagesSquare] },
  both: { label: 'Contract + conversation', icons: [FileText, MessagesSquare] },
};

/** Where the answer came from — the question's classification (conversation memory layer). */
function SourceLabel({ queryType }: { queryType: QueryType }) {
  const { label, icons } = SOURCES[queryType];
  return (
    <p className="flex items-center gap-1 text-body-sm text-text-secondary">
      {icons.map((Icon, i) => (
        <Icon key={i} aria-hidden="true" className="size-3" />
      ))}
      {label}
    </p>
  );
}

function formatTime(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function ChatMessage({ message, onRetry }: { message: Message; onRetry: (id: string) => void }) {
  const time = formatTime(message.created_at);

  if (message.role === 'user') {
    return (
      <li className="group flex flex-col items-end gap-1">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-brand px-4 py-2 text-body-lg font-normal text-bg-primary">
          {message.content}
        </div>
        <time
          dateTime={message.created_at}
          className="text-body-sm text-text-secondary opacity-0 transition-opacity duration-fast group-focus-within:opacity-100 group-hover:opacity-100"
        >
          {time}
        </time>
      </li>
    );
  }

  const failed = message.status === 'error' && !message.streaming && !message.stopped;
  const notFound = NOT_FOUND.has(message.content.trim());
  // Conversation answers have no page to cite; a BOTH answer may rely on the conversation alone.
  const fromConversation =
    message.query_type === 'history' || (message.query_type === 'both' && hasConversationAttribution(message.content));
  const uncited =
    !message.streaming && !failed && !message.stopped && message.content && !notFound && !fromConversation && message.cited_pages.length === 0;

  return (
    <li className="group flex flex-col items-start gap-1">
      {message.query_type ? <SourceLabel queryType={message.query_type} /> : null}
      <div
        aria-busy={message.streaming || undefined}
        className={cn(
          'max-w-[85%] rounded-lg border px-4 py-2 text-body-lg font-normal text-text-primary',
          failed ? 'border-error-border bg-error-bg' : 'border-border bg-bg-primary',
        )}
      >
        {message.content ? (
          <ReactMarkdown allowedElements={ALLOWED} skipHtml unwrapDisallowed remarkPlugins={[remarkCitations]} components={components}>
            {message.content}
          </ReactMarkdown>
        ) : message.streaming ? (
          <span className="sr-only">ContractIQ is answering…</span>
        ) : null}
        {message.streaming ? (
          <span aria-hidden="true" className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-text-primary align-middle" />
        ) : null}

        {failed ? (
          <div role="alert" className="mt-2 flex flex-col items-start gap-2">
            <p className="flex items-start gap-1 text-body-sm text-error-text">
              <AlertCircle aria-hidden="true" className="mt-px size-4 shrink-0" />
              {ERROR_MESSAGES[message.errorCode ?? 'AI_UNAVAILABLE']}
            </p>
            {message.question ? (
              <Button variant="secondary" onClick={() => onRetry(message.id)}>
                Retry
              </Button>
            ) : null}
          </div>
        ) : null}
        {message.stopped ? <p className="mt-1 text-body-sm text-text-secondary">Stopped</p> : null}
      </div>

      {message.cited_pages.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1 text-body-sm text-text-secondary">
          Sources:
          {message.cited_pages.map((page) => (
            <CitationChip key={page} page={page} />
          ))}
        </div>
      ) : null}
      {uncited ? (
        <p className="flex items-center gap-1 text-body-sm text-warning-text">
          <AlertTriangle aria-hidden="true" className="size-4" />
          No page cited — verify this in the document.
        </p>
      ) : null}
      {time && !message.streaming ? (
        <time
          dateTime={message.created_at}
          className="text-body-sm text-text-secondary opacity-0 transition-opacity duration-fast group-focus-within:opacity-100 group-hover:opacity-100"
        >
          {time}
        </time>
      ) : null}
    </li>
  );
}
