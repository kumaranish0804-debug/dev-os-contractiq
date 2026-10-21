import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// The design system's type scale (tailwind.config.ts fontSize). Without this, tailwind-merge reads
// `text-body-lg` as a text *colour* and drops a real colour such as `text-bg-primary` beside it.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['h1', 'h2', 'h3', 'h5', 'body-lg', 'body-sm'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
