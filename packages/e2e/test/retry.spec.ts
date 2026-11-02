import { expect, test } from '@playwright/test';
import { signInAt } from './helpers.js';

const down = { status: 503, contentType: 'application/json', body: '{"error":{"code":"x"}}' };

test('says why the first page could not load, and loads it on Retry', async ({ page }) => {
  let fail = true;
  await page.route('**/api/onboarding', (route) => (fail ? route.fulfill(down) : route.fallback()));
  await signInAt(page, '/');
  await expect(page.getByRole('alert')).toBeVisible();

  fail = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('clears the settings’ error once Retry succeeds', async ({ page }) => {
  let fail = true;
  await page.route('**/api/settings', (route) =>
    fail && route.request().method() === 'GET' ? route.fulfill(down) : route.fallback(),
  );
  await signInAt(page, '/settings');
  await expect(page.getByRole('alert')).toBeVisible();

  fail = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
