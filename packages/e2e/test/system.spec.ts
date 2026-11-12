import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { signIn } from './helpers.js';

test('reads the log of the server, filters it and opens a line', async ({ page }) => {
  await signIn(page);
  await page.getByRole('navigation').getByRole('link', { name: 'System' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'System' })).toBeVisible();

  // The server's own startup line is in the list.
  const listening = page.getByRole('button', { name: /Server listening/ });
  await expect(listening.first()).toBeVisible();

  // A line opens on its fields, and opening it pauses the live follow.
  await listening.first().click();
  await expect(page.getByRole('switch', { name: 'Follow live' })).not.toBeChecked();
  await expect(page.locator('pre').first()).toContainText('"component": "server"');

  // The search reaches the URL, and a filter that matches nothing says so, with a way back.
  await page.getByLabel('Search').fill('no-such-line-anywhere');
  await expect(page).toHaveURL(/q=no-such-line-anywhere/);
  await expect(page.getByText('No entry for these filters')).toBeVisible();
  await page.getByRole('button', { name: 'Reset the filters' }).click();
  await expect(page).not.toHaveURL(/q=/);
  await expect(listening.first()).toBeVisible();
});

test('opens already filtered from a link', async ({ page }) => {
  await signIn(page);
  await page.goto('/system?component=tmdb&level=error');
  await expect(page.getByLabel('Component')).toHaveValue('tmdb');
  await expect(page.getByRole('button', { name: 'Errors', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('records requests at the debug level, and goes back to info', async ({ page }) => {
  await signIn(page);
  await page.goto('/system');
  const level = page.getByLabel('Recorded level');
  await expect(level).toHaveValue('info');

  await level.selectOption('debug');
  await expect(page.getByText('Debug slows the server down')).toBeVisible();

  // Each answer is a line of the `http` component, once the level lets it through.
  await page.goto('/system?component=http');
  await expect(page.getByRole('button', { name: /GET \/api\/\S+ 200/ }).first()).toBeVisible();

  await page.getByLabel('Recorded level').selectOption('info');
  await expect(page.getByText('Debug slows the server down')).toBeHidden();
});

test('downloads the log as a file', async ({ page }) => {
  await signIn(page);
  await page.goto('/system');
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('kinoshelf.log');
  const path = await file.path();
  expect(await readFile(path, 'utf8')).toContain('Server listening');
});

test('shows what was sent to TMDB, by period, and the key and cache', async ({ page }) => {
  await signIn(page);
  await page.getByRole('navigation').getByRole('link', { name: 'System' }).click();
  await page
    .getByRole('navigation', { name: 'Sections of the System page' })
    .getByRole('link', { name: 'TMDB' })
    .click();
  await expect(page).toHaveURL(/tab=tmdb/);

  await expect(page.getByText('Requests sent', { exact: true })).toBeVisible();
  await expect(page.getByText('From the cache', { exact: true })).toBeVisible();

  // The period is in the URL, like the log's filters.
  await page.getByRole('button', { name: '7 days' }).click();
  await expect(page).toHaveURL(/range=7d/);
  await expect(page.getByRole('button', { name: '7 days' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // The key and the cache have their block; clearing asks first.
  await expect(page.getByRole('heading', { name: 'TMDB key' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Test the key' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'TMDB cache' })).toBeVisible();
});
