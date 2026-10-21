import { FileSearch, Gauge, MessageSquareText } from 'lucide-react';
import { LinkButton } from '@/components/ui/LinkButton';

const features = [
  {
    icon: FileSearch,
    title: 'Key terms with page references',
    body: 'Governing law, liability caps, notice periods and more — each linked to the exact page it came from.',
  },
  {
    icon: Gauge,
    title: 'Confidence you can see',
    body: 'Every term shows a confidence score and the sentence it was drawn from, so you know what to double-check.',
  },
  {
    icon: MessageSquareText,
    title: 'Chat grounded in your document',
    body: 'Ask questions in plain English. Answers come only from your contract and cite the page.',
  },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-bg-primary">
      <header className="flex items-center justify-between border-b border-border px-4 py-4 lg:px-28">
        <span className="text-h5 text-text-primary">ContractIQ</span>
        <nav className="flex items-center gap-2" aria-label="Account">
          <LinkButton href="/login" variant="ghost">
            Sign In
          </LinkButton>
          <LinkButton href="/signup">Get Started Free</LinkButton>
        </nav>
      </header>

      <main className="flex flex-1 flex-col gap-16 px-4 py-12 lg:px-28 lg:py-24">
        <section className="flex max-w-[760px] flex-col gap-6">
          <h1 className="text-h2 text-text-primary lg:text-h1">
            Understand every NDA and MSA before you sign
          </h1>
          <p className="text-body-lg font-normal text-text-secondary">
            Extract the terms that matter, see exactly where they are, and ask questions in plain
            English — no lawyer on call.
          </p>
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/signup" size="lg">
              Get Started Free
            </LinkButton>
            <LinkButton href="/login" variant="secondary" size="lg">
              Sign In
            </LinkButton>
          </div>
        </section>

        <section aria-labelledby="features-heading" className="flex flex-col gap-6">
          <h2 id="features-heading" className="text-h5 text-text-primary">
            How ContractIQ helps
          </h2>
          <ul className="grid gap-4 md:grid-cols-3">
            {features.map(({ icon: Icon, title, body }) => (
              <li
                key={title}
                className="flex flex-col gap-2 rounded-lg border border-border bg-bg-surface p-6"
              >
                <Icon aria-hidden className="h-6 w-6 text-brand" />
                <h3 className="text-body-lg text-text-primary">{title}</h3>
                <p className="text-body-sm text-text-secondary">{body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="demo-heading" className="flex flex-col gap-6">
          <h2 id="demo-heading" className="text-h5 text-text-primary">
            See it in action
          </h2>
          {/* Demo GIF slot: add public/demo.gif and replace this placeholder with
              <img src="/demo.gif" alt="ContractIQ extracting key terms from an NDA" /> */}
          <div
            role="img"
            aria-label="Demo of ContractIQ extracting key terms from an NDA (coming soon)"
            className="flex aspect-video w-full max-w-[960px] items-center justify-center rounded-lg border border-border bg-bg-subtle text-body-sm text-text-secondary"
          >
            Product demo coming soon
          </div>
        </section>
      </main>

      <footer className="flex flex-col gap-1 border-t border-border px-4 py-6 text-body-sm text-text-secondary lg:flex-row lg:justify-between lg:px-28">
        <span>ContractIQ is not legal advice.</span>
        <span>Powered by OpenAI GPT-4o</span>
      </footer>
    </div>
  );
}
