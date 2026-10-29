import { expect, test } from '@playwright/test';
import { signIn } from './helpers.js';

const SECRET = 'very-secret-token-4242';

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
});

test('saves the processing settings and finds them after a reload', async ({ page }) => {
  const section = page.locator('form', { has: page.getByRole('heading', { name: 'Processing' }) });
  await section.getByLabel('Automatic threshold (0–100)').fill('90');
  await section.getByLabel('File mode').selectOption('hardlink');
  await section.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(section.getByText('Saved.')).toBeVisible();

  await page.reload();
  const again = page.locator('form', { has: page.getByRole('heading', { name: 'Processing' }) });
  await expect(again.getByLabel('Automatic threshold (0–100)')).toHaveValue('90');
  await expect(again.getByLabel('File mode')).toHaveValue('hardlink');
});

test('refuses a threshold out of range before asking the server', async ({ page }) => {
  const section = page.locator('form', { has: page.getByRole('heading', { name: 'Processing' }) });
  await section.getByLabel('Automatic threshold (0–100)').fill('150');
  await section.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(section.getByRole('alert')).toContainText('a number from 0 to 100');
});

test('offers the bundled profiles and asks for a path only for one’s own file', async ({
  page,
}) => {
  const section = page.locator('form', { has: page.getByRole('heading', { name: 'Processing' }) });
  await expect(section.getByRole('option', { name: 'Plex', exact: true })).toBeAttached();
  await expect(section.getByLabel('Path of the YAML file')).toHaveCount(0);

  await section.getByLabel('Output profile').selectOption({ label: 'My own file…' });
  await section.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(section.getByRole('alert')).toContainText('path of your profile file');
  await section.getByLabel('Path of the YAML file').fill('/config/mine.yaml');
});

test('adds a webhook whose address is never shown back', async ({ page }) => {
  const section = page.locator('form', { has: page.getByRole('heading', { name: 'Webhooks' }) });
  await section.getByRole('button', { name: 'Add a webhook' }).click();
  await section.getByLabel('Webhook URL').fill(`https://hooks.example.test/${SECRET}`);
  await section.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(section.getByText('Address kept: https://hooks.example.test/')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(SECRET);
  await page.reload();
  await expect(page.locator('body')).not.toContainText(SECRET);
  await expect(page.getByText('Address kept:')).toBeVisible();
});

test('says where the API key comes from, and leaves it alone when a variable sets it', async ({
  page,
}) => {
  // The stack starts with KINOSHELF_API_KEY: replacing it here would be undone at the next start,
  // so the page points to the variable instead of offering the button. The replacement itself is
  // covered by the server's tests.
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'API key' }) });
  await expect(section.getByText('The key comes from KINOSHELF_API_KEY')).toBeVisible();
  await expect(section.getByRole('button', { name: 'Replace the API key' })).toHaveCount(0);
});
