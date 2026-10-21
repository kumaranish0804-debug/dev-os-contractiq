import { MessageSquareText } from 'lucide-react';

export const SUGGESTIONS: Record<'NDA' | 'MSA', string[]> = {
  NDA: [
    'What happens if I breach this NDA?',
    'How long do confidentiality obligations last?',
    'Can I share information with my contractors?',
  ],
  MSA: ['Is there an auto-renewal clause?', 'What is the liability cap?', 'How can this agreement be terminated?'],
};

// Empty-state prompt (Spec 09 §9.3).
export function SuggestedQuestions({
  contractType,
  disabled,
  onPick,
}: {
  contractType: 'NDA' | 'MSA';
  disabled: boolean;
  onPick: (question: string) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-6 px-4 py-12 text-center">
      <MessageSquareText aria-hidden="true" className="size-8 text-brand" />
      <div className="flex flex-col gap-2">
        <h3 className="text-h5 text-text-primary">Ask anything about this contract</h3>
        <p className="text-body-sm text-text-secondary">
          Answers come only from this document and cite the page they&apos;re based on.
        </p>
      </div>
      <ul className="flex flex-col items-stretch gap-2">
        {SUGGESTIONS[contractType].map((q) => (
          <li key={q}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(q)}
              className="w-full rounded-full border border-border bg-bg-primary px-4 py-2 text-body-sm text-text-primary transition-colors duration-fast ease-out hover:border-brand hover:bg-brand-subtle disabled:opacity-60"
            >
              {q}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
