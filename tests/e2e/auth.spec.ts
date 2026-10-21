import { expect, test } from './fixtures';

// Spec 12 §12.8 auth.spec @smoke. Accounts are created through the admin API: on the hosted
// project, submitting real sign-ups would send confirmation emails to fake addresses (Stage 5 decision).
test.describe('auth @smoke', () => {
  test('wrong password shows the error; correct password lands on the empty dashboard', async ({ page, user }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password', { exact: true }).fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Email or password is incorrect.')).toBeVisible();

    await page.getByLabel('Password', { exact: true }).fill(user.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'No contracts reviewed yet' })).toBeVisible();
  });

  test('protected pages redirect to login and return to the requested page', async ({ page, user }) => {
    await page.goto('/contracts/new');
    await expect(page).toHaveURL(/\/login\?next=%2Fcontracts%2Fnew$/);
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password', { exact: true }).fill(user.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/contracts\/new$/);
  });

  test('sign out returns to / and protects the app again (Spec 04 §4.8)', async ({ page, baseURL, signedIn }) => {
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Account menu' }).click();
    await expect(page.getByText(signedIn.email)).toBeVisible();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(`${baseURL}/`);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
  });

  test('sign-up form validates before submitting', async ({ page }) => {
    await page.goto('/signup');
    await page.getByLabel('Email').fill('cq-e2e-not-submitted@example.com');
    await page.getByLabel('Password', { exact: true }).fill('Correct-horse-9');
    await page.getByLabel('Confirm password').fill('Different-horse-9');
    await page.getByRole('button', { name: /create account|sign up/i }).click();
    await expect(page.getByText('Passwords do not match')).toBeVisible();
    await expect(page).toHaveURL(/\/signup$/);
  });

  test('signed-in users skip the auth pages', async ({ page, signedIn: _ }) => {
    await page.goto('/login');
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
