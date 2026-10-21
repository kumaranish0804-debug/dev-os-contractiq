import { LinkButton } from '@/components/ui/LinkButton';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-h5 text-text-primary">We couldn&apos;t find that page.</h1>
      <LinkButton href="/">Back to home</LinkButton>
    </main>
  );
}
