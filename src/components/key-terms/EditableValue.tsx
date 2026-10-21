'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { LIMITS } from '@shared/limits';
import { cn } from '@/lib/utils/cn';

const COUNTER_FROM = 1800;

/**
 * Click-to-edit term value (Spec 07 §7.5). Enter (without Shift) or blur saves, Esc cancels,
 * an empty value saves as "Not found". Focus returns to the value button afterwards.
 */
export function EditableValue({
  termName,
  value,
  onSave,
}: {
  termName: string;
  value: string | null;
  onSave: (value: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const editingRef = useRef(false);

  function startEditing() {
    editingRef.current = true;
    setEditing(true);
  }

  useEffect(() => {
    if (!editing) setDraft(value ?? '');
  }, [value, editing]);

  useEffect(() => {
    if (!editing && restoreFocus.current) {
      restoreFocus.current = false;
      buttonRef.current?.focus();
    }
  }, [editing]);

  // Auto-grow.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, editing]);

  function finish(save: boolean) {
    // Removing the textarea can fire a trailing blur; only the first finish() counts.
    if (!editingRef.current) return;
    editingRef.current = false;
    restoreFocus.current = true;
    setEditing(false);
    if (!save) {
      setDraft(value ?? '');
      return;
    }
    const next = draft.trim() === '' ? null : draft.trim();
    if (next !== (value?.trim() || null)) onSave(next);
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1">
        <textarea
          ref={textareaRef}
          // Opened by an explicit click/Enter, so focus belongs here.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          aria-label={`Edit value for ${termName}`}
          value={draft}
          maxLength={LIMITS.termValueMax}
          rows={1}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              finish(true);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              finish(false);
            }
          }}
          className="w-full resize-none overflow-hidden rounded-md border border-brand bg-bg-primary px-3 py-2 text-body-lg font-normal text-text-primary outline-none ring-1 ring-brand"
        />
        <div className="flex justify-between text-body-sm text-text-secondary">
          <span>Enter to save · Esc to cancel · Shift+Enter for a new line</span>
          {draft.length >= COUNTER_FROM ? (
            <span aria-live="polite">
              {draft.length}/{LIMITS.termValueMax}
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={`${value ?? 'Not found in this document'}. Edit value for ${termName}`}
      onClick={startEditing}
      className="group flex w-full items-start gap-2 rounded-md px-2 py-1 text-left transition-colors duration-fast ease-out hover:bg-bg-subtle -mx-2"
    >
      <span
        className={cn(
          'flex-1 whitespace-pre-wrap text-body-lg font-normal',
          value === null ? 'italic text-text-secondary' : 'text-text-primary',
        )}
      >
        {value ?? 'Not found in this document'}
      </span>
      <Pencil
        aria-hidden="true"
        className="mt-1 size-4 shrink-0 text-text-secondary opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-visible:opacity-100"
      />
    </button>
  );
}
