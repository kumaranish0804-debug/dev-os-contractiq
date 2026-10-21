import { seedContract } from '../integration/helpers';
import { expect, signIn, test } from './fixtures';

// Spec 12 §12.8 dashboard.spec.
test.describe('dashboard @smoke', () => {
  test('stats, sort by name, open a row, delete; another user sees none', async ({ page, signedIn, otherUser, browser, baseURL }) => {
    await seedContract(signedIn.id, { title: 'Charlie NDA', withFile: false, createdAt: '2026-10-01T10:00:00Z' });
    await seedContract(signedIn.id, { title: 'alpha MSA', type: 'MSA', withFile: false, createdAt: '2026-10-02T10:00:00Z' });
    const bravo = await seedContract(signedIn.id, { title: 'Bravo NDA', createdAt: '2026-10-03T10:00:00Z' });

    await page.goto('/dashboard');
    const card = (label: string) => page.locator('dl > div').filter({ hasText: label });
    await expect(card('Total reviewed')).toContainText('3');
    await expect(card('NDAs')).toContainText('2');
    await expect(card('MSAs')).toContainText('1');

    // Sorting is a desktop table feature; the mobile layout uses the "Sort by" select.
    const isMobile = (page.viewportSize()?.width ?? 1280) < 768;
    if (isMobile) {
      await page.getByLabel('Sort by').selectOption('title:asc');
      await expect(page).toHaveURL(/\?sort=title&dir=asc$/);
    } else {
      await page.getByRole('button', { name: 'Name' }).click();
      await expect(page).toHaveURL(/\?sort=title&dir=asc$/);
      const names = page.getByRole('table').getByRole('link');
      await expect(names).toHaveText(['alpha MSA', 'Bravo NDA', 'Charlie NDA']);
      await page.reload();
      await expect(page.getByRole('columnheader', { name: /Name/ })).toHaveAttribute('aria-sort', 'ascending');

      await page.getByRole('table').getByRole('row').filter({ hasText: 'Bravo NDA' }).getByText('NDA', { exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/contracts/${bravo.contractId}$`));
      await expect(page.getByRole('heading', { name: 'Bravo NDA' })).toBeVisible();
      await page.goto('/dashboard');
    }

    const actions = page.getByRole('button', { name: 'Actions for Bravo NDA' }).locator('visible=true');
    await actions.click();
    await page.getByRole('menuitem', { name: 'Delete…' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete contract' }).click();
    await expect(page.getByText('Contract deleted').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Bravo NDA' }).locator('visible=true')).toHaveCount(0);
    await expect(card('Total reviewed')).toContainText('2');

    const other = await browser.newContext();
    await signIn(other, otherUser, baseURL!);
    const otherPage = await other.newPage();
    await otherPage.goto('/dashboard');
    await expect(otherPage.getByRole('heading', { name: 'No contracts reviewed yet' })).toBeVisible();
    await other.close();
  });
});
