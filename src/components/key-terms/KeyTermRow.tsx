'use client';

import { AlertTriangle } from 'lucide-react';
import { needsReview } from '@shared/confidence';
import { TERM_LIBRARY } from '@shared/term-library';
import { ConfidenceBadge } from '@/components/key-terms/ConfidenceBadge';
import { EditableValue } from '@/components/key-terms/EditableValue';
import { PageLink } from '@/components/key-terms/PageLink';
import { WhyDisclosure } from '@/components/key-terms/WhyDisclosure';
import { GlossaryTooltip } from '@/components/shared/GlossaryTooltip';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { Tooltip } from '@/components/ui/Tooltip';
import type { KeyTerm } from '@/lib/data/contracts';

const CUSTOM_GLOSSARY = 'Custom term you added';

function glossaryFor(term: KeyTerm, contractType: 'NDA' | 'MSA'): string {
  if (term.is_custom) return CUSTOM_GLOSSARY;
  return TERM_LIBRARY[contractType].find((t) => t.key === term.term_key)?.glossary ?? CUSTOM_GLOSSARY;
}

// One key term (Spec 07 §7.4): name, badges, page link, confidence, editable value, "Why?".
export function KeyTermRow({
  term,
  contractType,
  saving,
  onSave,
}: {
  term: KeyTerm;
  contractType: 'NDA' | 'MSA';
  saving: boolean;
  onSave: (value: string | null) => void;
}) {
  const nameId = `term-${term.id}-name`;
  const low = needsReview(term);

  return (
    <li aria-labelledby={nameId} className="flex flex-col gap-2 border-b border-border py-4 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex min-w-0 items-center gap-1">
          <span id={nameId} className="text-body-lg text-text-primary">
            {term.term_name}
          </span>
          <GlossaryTooltip term={term.term_name} text={glossaryFor(term, contractType)} />
        </span>
        {term.is_custom ? <Badge variant="info">Custom</Badge> : null}
        {term.is_edited ? (
          <Tooltip content={`AI extracted: ${term.original_value ?? 'Not found'}`}>
            <button
              type="button"
              aria-label={`Edited. AI extracted: ${term.original_value ?? 'Not found'}`}
              className="inline-flex items-center rounded-sm border border-brand bg-brand-subtle px-2 py-0.5 text-body-sm font-medium text-brand"
            >
              Edited
            </button>
          </Tooltip>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          {term.page_number ? <PageLink page={term.page_number} sentence={term.source_sentence} /> : null}
          <ConfidenceBadge score={term.confidence_score} found={term.value !== null} />
        </span>
      </div>

      <EditableValue termName={term.term_name} value={term.value} onSave={onSave} />

      {low ? (
        <p className="flex items-start gap-1 text-body-sm text-error-text">
          <AlertTriangle aria-hidden="true" className="mt-px size-4 shrink-0" />
          Low confidence — we recommend verifying this in the document directly.
        </p>
      ) : null}

      {saving ? (
        <p aria-live="polite" className="flex items-center gap-1 text-body-sm text-text-secondary">
          <Spinner className="size-3" />
          Saving…
        </p>
      ) : null}

      <WhyDisclosure sentence={term.source_sentence} page={term.page_number} />
    </li>
  );
}
