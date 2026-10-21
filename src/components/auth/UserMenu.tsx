'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { Spinner } from '@/components/ui/Spinner';
import { createClient } from '@/lib/supabase/client';

// Avatar initial + menu with the read-only email and "Sign out" (Spec 04 §4.8).
export function UserMenu({ email }: { email: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);
  const initial = email.charAt(0).toUpperCase() || '?';

  async function signOut() {
    setSigningOut(true);
    try {
      // Clears the local session even when the network call fails.
      await createClient().auth.signOut();
    } finally {
      queryClient.clear();
      router.replace('/');
      router.refresh();
    }
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label="Account menu"
        className="flex size-10 items-center justify-center rounded-full bg-brand-subtle text-body-lg text-brand transition-colors duration-fast ease-out hover:bg-bg-subtle"
      >
        {signingOut ? <Spinner /> : <span aria-hidden="true">{initial}</span>}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 flex min-w-56 flex-col gap-1 rounded-lg border border-border bg-bg-primary p-1"
        >
          <DropdownMenu.Label className="px-3 py-2">
            <span className="block text-body-sm text-text-secondary">Signed in as</span>
            <span className="block truncate text-body-lg text-text-primary">{email}</span>
          </DropdownMenu.Label>
          <DropdownMenu.Separator className="h-px bg-bg-subtle" />
          <DropdownMenu.Item
            disabled={signingOut}
            onSelect={signOut}
            className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-body-lg text-text-primary outline-none transition-colors duration-fast ease-out data-[disabled]:cursor-not-allowed data-[highlighted]:bg-bg-subtle data-[disabled]:opacity-60"
          >
            <LogOut aria-hidden="true" className="size-4" />
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
