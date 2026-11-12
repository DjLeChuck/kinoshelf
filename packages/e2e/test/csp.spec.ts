import { expect, test } from '@playwright/test';
import { signIn } from './helpers.js';

test('breaks no rule of its own content security policy', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) {
      violations.push(message.text().slice(0, 160));
    }
  });
  await signIn(page);
  for (const path of ['/history', '/settings', '/arrivals', '/libraries', '/system']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  }
  expect(violations).toEqual([]);
});
