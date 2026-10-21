'use client';

import { cn } from '@/lib/utils/cn';
import type { ContractType } from '@/stores/review-session-store';

const OPTIONS: { value: ContractType; title: string; description: string }[] = [
  { value: 'NDA', title: 'NDA', description: 'Non-Disclosure Agreement — confidentiality between parties.' },
  { value: 'MSA', title: 'MSA', description: 'Master Service Agreement — terms for ongoing services.' },
];

// Radio cards (Spec 05 §5.3). Native radios give arrow-key navigation within the group.
export function ContractTypeSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: ContractType | null;
  onChange: (value: ContractType) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset role="radiogroup" aria-labelledby="contract-type-legend" className="flex flex-col gap-4">
      <legend id="contract-type-legend" className="mb-4 text-body-lg text-text-primary">
        1. Choose the contract type
      </legend>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {OPTIONS.map((option) => {
          const selected = value === option.value;
          return (
            <label
              key={option.value}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors duration-fast ease-out',
                'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand',
                selected
                  ? 'border-brand bg-brand-subtle'
                  : 'border-border bg-bg-primary hover:border-border-strong hover:bg-bg-subtle',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type="radio"
                name="contract-type"
                value={option.value}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(option.value)}
                className="mt-1 size-4 shrink-0 accent-brand focus-visible:outline-none"
              />
              <span className="flex flex-col gap-1">
                <span className="text-body-lg text-text-primary">{option.title}</span>
                <span className="text-body-sm text-text-secondary">{option.description}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
