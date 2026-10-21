import { LEGAL_DISCLAIMER } from '../../src/components/shared/LegalDisclaimer';
import { seedContract } from '../integration/helpers';
import { expect, test } from './fixtures';

// Spec 12 §12.8 results.spec, on a seeded completed contract with its stored PDF.
test.describe('results page', () => {
  test('disclaimer, page navigation, low-confidence warning and Why?', async ({ page, signedIn }) => {
    const { contractId } = await seedContract(signedIn.id);
    await page.goto(`/contracts/${contractId}`);

    await expect(page.getByText(LEGAL_DISCLAIMER)).toBeVisible();
    const period = page.getByRole('listitem', { name: 'Confidentiality Period' });
    await expect(period.getByText('Low confidence — we recommend verifying this in the document directly.')).toBeVisible();

    const law = page.getByRole('listitem', { name: 'Governing Law' });
    await law.getByRole('button', { name: 'Go to page 3' }).click();
    await expect(page.locator('#pdf-page-3')).toBeInViewport({ timeout: 20_000 });

    await law.getByRole('button', { name: 'Why?' }).click();
    await expect(law.getByText('This Agreement is governed by the laws of the State of New York.')).toBeVisible();
  });

  test('edit persists with Edited; Esc cancels', async ({ page, signedIn }) => {
    const { contractId } = await seedContract(signedIn.id);
    await page.goto(`/contracts/${contractId}`);
    const law = page.getByRole('listitem', { name: 'Governing Law' });

    await law.getByRole('button', { name: /Edit value for Governing Law/ }).click();
    const box = page.getByLabel('Edit value for Governing Law', { exact: true });
    await box.fill('State of Delaware');
    // "Edited" appears optimistically; wait for the save itself before reloading.
    const saved = page.waitForResponse((r) => r.url().includes('/api/key-terms/') && r.request().method() === 'PATCH');
    await box.press('Enter');
    await expect(law.getByText('Edited')).toBeVisible();
    expect((await saved).status()).toBe(200);

    await page.reload();
    const reloaded = page.getByRole('listitem', { name: 'Governing Law' });
    await expect(reloaded.getByText('State of Delaware')).toBeVisible();
    await expect(reloaded.getByText('Edited')).toBeVisible();

    await reloaded.getByRole('button', { name: /Edit value for Governing Law/ }).click();
    await page.getByLabel('Edit value for Governing Law', { exact: true }).fill('Discarded');
    await page.getByLabel('Edit value for Governing Law', { exact: true }).press('Escape');
    await expect(reloaded.getByText('State of Delaware')).toBeVisible();
    await expect(reloaded.getByText('Discarded')).toHaveCount(0);
  });

  test('feedback 👎 + comment persists; review can be marked complete', async ({ page, signedIn }) => {
    const { contractId } = await seedContract(signedIn.id);
    // The seeded contract already has 👍; Edit, change to 👎 with a comment.
    await page.goto(`/contracts/${contractId}`);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: 'No, not accurate' }).click();
    await page.getByLabel('Anything we got wrong? (optional)').fill('Term length is wrong');
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByText('Thanks for your feedback.')).toBeVisible();

    await page.reload();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.getByRole('button', { name: 'No, not accurate' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Anything we got wrong? (optional)')).toHaveValue('Term length is wrong');

    await page.getByRole('button', { name: 'Mark review complete' }).click();
    await expect(page.getByRole('button', { name: /Reviewed ✓/ })).toBeDisabled();
  });
});
