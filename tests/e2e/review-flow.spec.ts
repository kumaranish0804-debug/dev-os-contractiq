import { resolve } from 'node:path';
import { LEGAL_DISCLAIMER } from '../../src/components/shared/LegalDisclaimer';
import { FIXTURES } from '../integration/helpers';
import { expect, test } from './fixtures';

// Spec 12 §12.8 review-flow.spec @smoke. Needs process-contract deployed with an OpenAI key, so it
// runs only with E2E_AI=1. Values come from the live model, so they are checked for shape, not text.
test.skip(!process.env.E2E_AI, 'Set E2E_AI=1 once process-contract is deployed with an OpenAI key');

test('@smoke NDA upload → preview → custom term → process → results', async ({ page, signedIn: _ }) => {
  test.setTimeout(120_000);
  await page.goto('/contracts/new');
  await page.getByRole('radio', { name: /^NDA/ }).check();
  await expect(page.getByText('10 standard terms for NDA contracts')).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles(resolve(FIXTURES, 'nda-3-pages.pdf'));
  await page.getByRole('button', { name: 'Add Key Term' }).click();
  await page.getByLabel('Custom term').fill('Audit rights');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await page.getByRole('button', { name: 'Process Contract' }).click();
  await expect(page).toHaveURL(/\/contracts\/[0-9a-f-]{36}$/, { timeout: 90_000 });

  await expect(page.getByText(LEGAL_DISCLAIMER)).toBeVisible();
  await expect(page.getByText(/^11 terms · \d+ need review$/)).toBeVisible();
  const custom = page.getByRole('listitem', { name: 'Audit rights' });
  await expect(custom.getByText('Custom')).toBeVisible();
  await expect(page.getByRole('listitem', { name: 'Governing Law' }).getByText(/% (High|Medium|Low)|—/)).toBeVisible();
});
