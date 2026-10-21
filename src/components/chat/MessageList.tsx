'use client';

import { useEffect, useRef } from 'react';
import { ChatMessage } from '@/components/chat/ChatMessage';
import type { ChatMessage as Message } from '@/hooks/use-chat';

const STICK_TO_BOTTOM_PX = 80;

// Scrolls with new content only while the reader is already near the bottom (Spec 09 §9.2).
export function MessageList({ messages, onRetry }: { messages: Message[]; onRetry: (id: string) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const lastContent = messages.at(-1)?.content;

  useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, lastContent]);

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_TO_BOTTOM_PX;
      }}
      className="min-h-0 flex-1 overflow-y-auto pr-1"
    >
      <ol aria-live="polite" aria-label="Conversation" className="flex flex-col gap-4">
        {messages.map((m) => (
          <ChatMessage key={m.id} message={m} onRetry={onRetry} />
        ))}
      </ol>
    </div>
  );
}
