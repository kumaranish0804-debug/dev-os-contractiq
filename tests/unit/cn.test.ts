import { describe, expect, it } from 'vitest';
import { buttonClasses } from '@/components/ui/button-styles';
import { cn } from '@/lib/utils/cn';

// Regression: tailwind-merge treated the type-scale classes as text colours, so primary buttons lost
// their white text (`text-bg-primary`) and rendered near-black on blue — 3.2:1, an axe AA failure.
describe('cn', () => {
  it('keeps a text colour next to a design-system type size', () => {
    for (const size of ['text-h1', 'text-h2', 'text-h3', 'text-h5', 'text-body-lg', 'text-body-sm']) {
      expect(cn('text-bg-primary', size).split(' ')).toEqual(['text-bg-primary', size]);
    }
  });

  it('still resolves real conflicts within each group', () => {
    expect(cn('text-body-sm', 'text-body-lg')).toBe('text-body-lg');
    expect(cn('text-text-secondary', 'text-error-text')).toBe('text-error-text');
  });

  it('primary buttons keep white text', () => {
    const classes = buttonClasses('primary', 'md').split(' ');
    expect(classes).toContain('text-bg-primary');
    expect(classes).toContain('text-body-lg');
  });
});
