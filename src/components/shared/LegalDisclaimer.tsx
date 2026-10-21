import { Scale } from 'lucide-react';

export const LEGAL_DISCLAIMER =
  'This is an AI-assisted review tool, not legal advice. Always verify critical terms with a qualified lawyer.';

// Always visible on results pages; not dismissible (Spec 07 §7.2).
export function LegalDisclaimer() {
  return (
    <p className="flex items-start gap-2 rounded-md border border-info-border bg-info-bg px-3 py-2 text-body-sm text-info-text">
      <Scale aria-hidden="true" className="mt-px size-4 shrink-0" />
      {LEGAL_DISCLAIMER}
    </p>
  );
}
