import { seedContract } from '../integration/helpers';
import { expect, test } from './fixtures';

// Spec 12 §12.8 chat.spec. Needs the chat function deployed with an OpenAI key (E2E_AI=1).
test.skip(!process.env.E2E_AI, 'Set E2E_AI=1 once chat is deployed with an OpenAI key');

test('grounded answer with a page chip, history on reload, exact not-found reply', async ({ page, signedIn }) => {
  test.setTimeout(120_000);
  const { contractId } = await seedContract(signedIn.id);
  await page.goto(`/contracts/${contractId}?tab=chat`);

  const input = page.getByLabel(/Ask a question/i);
  await input.fill('How long do the confidentiality obligations last?');
  await input.press('Enter');
  const answer = page.getByRole('log').getByText(/^Based on the document,/).last();
  await expect(answer).toBeVisible({ timeout: 45_000 });
  const chip = page.getByRole('button', { name: /Go to page 2/ }).first();
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page.locator('#pdf-page-2')).toBeInViewport({ timeout: 20_000 });

  await page.reload();
  await expect(page.getByText('How long do the confidentiality obligations last?')).toBeVisible();

  await page.getByLabel(/Ask a question/i).fill("What's the capital of France?");
  await page.getByLabel(/Ask a question/i).press('Enter');
  await expect(page.getByText('I cannot find this in the document.', { exact: true }).last()).toBeVisible({ timeout: 45_000 });
});
