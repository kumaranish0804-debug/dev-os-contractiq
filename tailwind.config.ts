import type { Config } from 'tailwindcss';

// Only semantic tokens from docs/design.md are exposed — never raw primitives.
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        text: { primary: 'var(--text-primary)', secondary: 'var(--text-secondary)' },
        bg: { primary: 'var(--bg-primary)', surface: 'var(--bg-surface)', subtle: 'var(--bg-subtle)' },
        brand: { DEFAULT: 'var(--brand)', hover: 'var(--brand-hover)', subtle: 'var(--brand-subtle)' },
        border: { DEFAULT: 'var(--border-default)', strong: 'var(--border-strong)' },
        success: { bg: 'var(--success-bg)', border: 'var(--success-border)', text: 'var(--success-text)' },
        warning: { bg: 'var(--warning-bg)', border: 'var(--warning-border)', text: 'var(--warning-text)' },
        error: { bg: 'var(--error-bg)', border: 'var(--error-border)', text: 'var(--error-text)' },
        info: { bg: 'var(--info-bg)', border: 'var(--info-border)', text: 'var(--info-text)' },
        highlight: 'var(--highlight-bg)',
      },
      fontFamily: { sans: ['var(--font-inter-display)', 'Inter', 'system-ui', 'sans-serif'] },
      fontSize: {
        h1: ['48px', { lineHeight: '56px', fontWeight: '700' }],
        h2: ['36px', { lineHeight: '44px', fontWeight: '700' }],
        h3: ['30px', { lineHeight: '38px', fontWeight: '600' }],
        h5: ['24px', { lineHeight: '32px', fontWeight: '500' }],
        'body-lg': ['16px', { lineHeight: '24px', fontWeight: '500' }],
        'body-sm': ['12px', { lineHeight: '18px', fontWeight: '400' }],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      ringColor: { DEFAULT: 'var(--focus-ring)' },
      transitionDuration: { fast: '100ms', base: '150ms', panel: '200ms' },
    },
  },
  plugins: [],
} satisfies Config;
