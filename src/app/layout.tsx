import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { Providers } from './providers';
import './globals.css';

const interDisplay = localFont({
  src: [
    { path: './fonts/InterDisplay-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/InterDisplay-Medium.woff2', weight: '500', style: 'normal' },
    { path: './fonts/InterDisplay-SemiBold.woff2', weight: '600', style: 'normal' },
    { path: './fonts/InterDisplay-Bold.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-inter-display',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ContractIQ — Understand your NDAs and MSAs in minutes',
  description:
    'Extract the key terms from any NDA or MSA with page references and confidence scores, then ask questions in plain English.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={interDisplay.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
