'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { SendHorizontal, Square } from 'lucide-react';
import { LIMITS } from '@shared/limits';
import { Button } from '@/components/ui/Button';

const COUNTER_FROM = 1800;
const MAX_LINES = 6;
const LINE_HEIGHT_PX = 24;

// Enter sends, Shift+Enter adds a line; disabled with a Stop button while answering (Spec 09 §9.3).
export function ChatInput({
  streaming,
  onSend,
  onStop,
}: {
  streaming: boolean;
  onSend: (question: string) => void;
  onStop: () => void;
}) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const trimmed = value.trim();
  const canSend = !streaming && trimmed.length >= 1 && trimmed.length <= LIMITS.chatMessageMax;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_LINES * LINE_HEIGHT_PX + 16)}px`;
  }, [value]);

  function submit() {
    if (!canSend) return;
    onSend(trimmed);
    setValue('');
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-1"
    >
      <div className="flex items-end gap-2">
        <label htmlFor="chat-input" className="sr-only">
          Ask a question about this contract
        </label>
        <textarea
          id="chat-input"
          ref={ref}
          rows={1}
          value={value}
          disabled={streaming}
          maxLength={LIMITS.chatMessageMax}
          placeholder={streaming ? 'ContractIQ is answering…' : 'Ask a question about this contract'}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className="min-h-10 flex-1 resize-none rounded-md border border-border bg-bg-primary px-3 py-2 text-body-lg font-normal text-text-primary transition-colors duration-fast ease-out placeholder:text-text-secondary hover:border-border-strong focus-visible:border-brand focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand disabled:bg-bg-surface"
        />
        {streaming ? (
          <Button variant="secondary" onClick={onStop} aria-label="Stop answering">
            <Square aria-hidden="true" className="size-4" />
            Stop
          </Button>
        ) : (
          <Button type="submit" disabled={!canSend} aria-label="Send question">
            <SendHorizontal aria-hidden="true" className="size-4" />
          </Button>
        )}
      </div>
      <div className="flex justify-between text-body-sm text-text-secondary">
        <span>AI answers can be wrong. Not legal advice.</span>
        {value.length >= COUNTER_FROM ? (
          <span aria-live="polite">
            {value.length}/{LIMITS.chatMessageMax}
          </span>
        ) : null}
      </div>
    </form>
  );
}
