import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { seedContract } from '../integration/helpers';
import { expect, test } from './fixtures';

// Spec 12 §12.8 a11y.spec: 0 serious/critical axe violations on every page.
async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const blocking = violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.impact} ${v.id}: ${v.help} — ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`);
  expect(blocking).toEqual([]);
}

test.describe('accessibility', () => {
  for (const path of ['/', '/login', '/signup']) {
    test(`${path} (signed out)`, async ({ page }) => {
      await page.goto(path);
      await expectAccessible(page);
    });
  }

  test('dashboard empty, review wizard', async ({ page, signedIn: _ }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'No contracts reviewed yet' })).toBeVisible();
    await expectAccessible(page);
    await page.goto('/contracts/new');
    await page.getByRole('radio', { name: /^NDA/ }).check();
    await expectAccessible(page);
  });

  test('dashboard populated, results (terms + chat tabs)', async ({ page, signedIn }) => {
    const { contractId } = await seedContract(signedIn.id);
    await seedContract(signedIn.id, { title: 'Second MSA', type: 'MSA', withFile: false });

    await page.goto('/dashboard');
    await expect(page.getByRole('table')).toBeVisible();
    await expectAccessible(page);

    await page.goto(`/contracts/${contractId}`);
    await expect(page.getByRole('listitem', { name: 'Governing Law' })).toBeVisible();
    await expectAccessible(page);

    await page.getByRole('tab', { name: 'Chat' }).click();
    await expect(page.getByText('Based on the document, the governing law is the State of New York')).toBeVisible();
    await expectAccessible(page);
  });
});
