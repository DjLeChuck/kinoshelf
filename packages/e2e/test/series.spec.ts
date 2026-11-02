import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { API_KEY, library } from '../support.js';
import { signIn } from './helpers.js';

test('browses a series library as a tree and finds the episode it lacks', async ({
  page,
  request,
}) => {
  const folder = library('series');
  await mkdir(folder, { recursive: true });
  // The first season lacks its second episode; the second holds the only one that has aired.
  for (const name of ['S01E01', 'S01E03', 'S02E01']) {
    await writeFile(`${folder}/Severance.${name}.1080p.mkv`, 'video');
  }
  const headers = { authorization: `Bearer ${API_KEY}` };
  expect((await request.post('/api/libraries/series/scan', { headers })).status()).toBe(202);

  await signIn(page);
  await page.goto('/libraries/series');
  const show = page.getByRole('button', { name: 'Show the seasons of Severance' });
  await expect(show).toBeVisible();

  // The count is made in the background, then shown on the line of the show.
  await expect(page.getByText('Missing: 1').first()).toBeVisible();

  await show.click();
  await page.getByRole('button', { name: /Season 1/ }).click();
  await expect(page.getByText('S01E02')).toBeVisible();
  await expect(page.locator('tbody').getByText('Missing', { exact: true })).toBeVisible();
  // The season that is not over owes nothing for what has not aired.
  await page.getByRole('button', { name: /Season 2/ }).click();
  await expect(page.getByText('Not aired')).toBeVisible();

  // The filter keeps the shows that lack some.
  await page.getByRole('button', { name: /Missing episodes/ }).click();
  await expect(page.getByRole('button', { name: /Severance/ })).toBeVisible();
});
