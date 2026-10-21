import type { Metadata } from 'next';
import { SignUpCard } from '@/components/auth/SignUpCard';

export const metadata: Metadata = { title: 'Create your account — ContractIQ' };

export default function SignUpPage() {
  return <SignUpCard />;
}
