// Playwright fixtures: a fresh confirmed user per test (deleted afterwards) and cookie sign-in.
import { test as base, expect, type BrowserContext } from '@playwright/test';
import { createTestUser, deleteTestUser, type TestUser } from '../integration/helpers';

async function signIn(context: BrowserContext, user: TestUser, baseURL: string) {
  const { hostname } = new URL(baseURL);
  await context.addCookies(
    user.cookies.map((c) => ({ name: c.name, value: c.value, domain: hostname, path: '/', sameSite: 'Lax' as const })),
  );
}

export const test = base.extend<{ user: TestUser; signedIn: TestUser; otherUser: TestUser }>({
  user: async ({}, use) => {
    const user = await createTestUser('e2e');
    await use(user);
    await deleteTestUser(user.id);
  },
  /** The `user`, already signed in for this page's context. */
  signedIn: async ({ user, context, baseURL }, use) => {
    await signIn(context, user, baseURL!);
    await use(user);
  },
  otherUser: async ({}, use) => {
    const user = await createTestUser('e2e');
    await use(user);
    await deleteTestUser(user.id);
  },
});

export { expect, signIn };
