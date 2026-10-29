import { expect, test } from '@playwright/test';
import { signIn } from './helpers.js';

test('refuses a wrong key, accepts the right one, and signs out', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('API key').fill('not-the-key');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Wrong API key');

  await signIn(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('keeps the session across a reload and sends a deep link to its page', async ({ page }) => {
  await signIn(page);
  await page.goto('/history');
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
});

test('switches the language of the whole UI', async ({ page }) => {
  await signIn(page);
  await page.getByLabel('Language').selectOption('fr');
  await expect(page.getByRole('heading', { name: 'File de validation' })).toBeVisible();
  await page.getByLabel('Langue').selectOption('en');
  await expect(page.getByRole('heading', { name: 'Validation queue' })).toBeVisible();
});
