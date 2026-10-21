'use client';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-h5 text-text-primary">Something went wrong on our side.</h1>
      <p className="text-body-sm text-text-secondary">Please try again.</p>
      <button
        type="button"
        onClick={reset}
        className="h-10 rounded-md bg-brand px-4 text-body-lg text-bg-primary transition-colors duration-fast hover:bg-brand-hover"
      >
        Try again
      </button>
    </main>
  );
}
