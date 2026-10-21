import { seedContract } from '../integration/helpers';
import { expect, test } from './fixtures';

// Spec 12 §12.8 viewer-fallback.spec: no stored file → text viewer + notice; page links still work.
test('without a stored PDF the text viewer is shown and page links navigate', async ({ page, signedIn }) => {
  const { contractId } = await seedContract(signedIn.id, { withFile: false });
  await page.goto(`/contracts/${contractId}`);

  await expect(page.getByText("The original PDF isn't available, so we're showing the extracted text.")).toBeVisible();
  await expect(page.getByLabel('Contract text')).toBeVisible();

  await page.getByRole('listitem', { name: 'Governing Law' }).getByRole('button', { name: 'Go to page 3' }).click();
  await expect(page.locator('#text-page-3')).toBeInViewport();
});
