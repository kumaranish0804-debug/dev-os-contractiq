'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { getStandardTerms } from '@shared/term-library';
import { LIMITS } from '@shared/limits';
import { GlossaryTooltip } from '@/components/shared/GlossaryTooltip';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useReviewSessionStore, type ContractType } from '@/stores/review-session-store';

function AddCustomTermInput({ onDone }: { onDone: () => void }) {
  const addCustomTerm = useReviewSessionStore((s) => s.addCustomTerm);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const errorId = `${inputId}-error`;

  function submit() {
    const result = addCustomTerm(value);
    if (result.ok) {
      onDone();
    } else {
      setError(result.reason);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-body-sm text-text-secondary">
        Custom term
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={inputId}
          // Opened by an explicit click, so focus belongs here.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          value={value}
          maxLength={LIMITS.customTermMax + 20}
          placeholder="e.g. Audit rights"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onDone();
            }
          }}
          className={`h-10 min-w-0 flex-1 rounded-md border bg-bg-primary px-3 text-body-lg text-text-primary transition-colors duration-fast ease-out placeholder:text-text-secondary focus-visible:border-brand focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand ${
            error ? 'border-error-text' : 'border-border hover:border-border-strong'
          }`}
        />
        <Button onClick={submit}>Add</Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-body-sm text-error-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// "What we'll look for" (Spec 06 §6.3): visible as soon as a type is chosen, during upload too.
export function TermPreviewCard({ contractType, locked }: { contractType: ContractType; locked: boolean }) {
  const customTerms = useReviewSessionStore((s) => s.customTerms);
  const removeCustomTerm = useReviewSessionStore((s) => s.removeCustomTerm);
  const [adding, setAdding] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const standard = getStandardTerms(contractType);
  const atLimit = customTerms.length >= LIMITS.maxCustomTerms;

  // Return focus to "Add Key Term" once the input has closed (it re-renders in the same commit).
  useEffect(() => {
    if (!adding && restoreFocus.current) {
      restoreFocus.current = false;
      addButtonRef.current?.focus();
    }
  }, [adding]);

  function closeInput() {
    restoreFocus.current = true;
    setAdding(false);
  }

  return (
    <section
      aria-labelledby="term-preview-title"
      className="flex flex-col gap-6 rounded-lg border border-border bg-bg-primary p-6"
    >
      <header className="flex flex-col gap-1">
        <h2 id="term-preview-title" className="text-h5 text-text-primary">
          What we&apos;ll look for
        </h2>
        <p className="text-body-sm text-text-secondary">
          {standard.length} standard terms for {contractType} contracts
        </p>
      </header>

      <ul className="grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2">
        {standard.map((term) => (
          <li key={term.key} className="flex items-center gap-1 text-body-lg text-text-primary">
            {term.name}
            <GlossaryTooltip term={term.name} text={term.glossary} />
          </li>
        ))}
        {customTerms.map((name) => (
          <li key={name} className="flex items-center gap-2 text-body-lg text-text-primary">
            <span className="min-w-0 truncate">{name}</span>
            <Badge variant="info">Custom</Badge>
            {locked ? null : (
              <button
                type="button"
                aria-label={`Remove ${name}`}
                onClick={() => removeCustomTerm(name)}
                className="inline-flex size-6 items-center justify-center rounded-sm text-text-secondary transition-colors duration-fast ease-out hover:bg-bg-subtle hover:text-text-primary"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            )}
          </li>
        ))}
      </ul>

      {locked ? null : adding ? (
        <AddCustomTermInput onDone={closeInput} />
      ) : (
        <div className="flex flex-col items-start gap-1">
          <Button
            ref={addButtonRef}
            variant="secondary"
            disabled={atLimit}
            aria-describedby={atLimit ? 'custom-term-limit' : undefined}
            onClick={() => setAdding(true)}
          >
            <Plus aria-hidden="true" className="size-4" />
            Add Key Term
          </Button>
          {atLimit ? (
            <p id="custom-term-limit" className="text-body-sm text-text-secondary">
              Maximum 5 custom terms
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
