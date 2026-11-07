import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { AUTH_HEADERS, incoming, library } from '../support.js';
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
  expect(
    (await request.post('/api/libraries/series/scan', { headers: AUTH_HEADERS })).status(),
  ).toBe(202);

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

test('renames every episode of the ticked shows in one go', async ({ page, request }) => {
  const folder = library('series');
  await mkdir(folder, { recursive: true });
  for (const name of ['S01E01', 'S01E02', 'S02E01']) {
    await writeFile(`${folder}/Severance.${name}.1080p.mkv`, 'video');
  }
  expect(
    (await request.post('/api/libraries/series/scan', { headers: AUTH_HEADERS })).status(),
  ).toBe(202);

  await signIn(page);
  await page.goto('/libraries/series');
  await page.getByRole('checkbox', { name: /Select Severance/ }).check();
  await expect(page.getByText('Selected shows: 1')).toBeVisible();
  await page.getByRole('button', { name: 'Rename…' }).click();

  // One preview for the three episodes, nothing picked one by one.
  const dialog = page.getByRole('dialog', { name: 'Rename preview' });
  await expect(dialog.getByText(/[3-9] to move/)).toBeVisible();
});

test('shows which NFO and images a show and its seasons have', async ({ page, request }) => {
  const folder = incoming('series-files');
  const show = `${folder}/Severance (2022) {tmdb-95396}`;
  await mkdir(`${show}/Season 01`, { recursive: true });
  await writeFile(`${show}/Season 01/Severance (2022) S01E01.mkv`, 'video');
  // The show has its NFO and poster, the season its poster; the fanart and the logo are missing.
  for (const name of ['tvshow.nfo', 'poster.jpg', 'Season 01/poster.jpg']) {
    await writeFile(`${show}/${name}`, 'x');
  }
  const created = await request.post('/api/libraries', {
    headers: AUTH_HEADERS,
    data: { name: 'Jelly series', source: folder, type: 'series', profile: 'jellyfin' },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  expect(
    (await request.post(`/api/libraries/${id}/scan`, { headers: AUTH_HEADERS })).status(),
  ).toBe(202);

  await signIn(page);
  await page.goto(`/libraries/${id}`);
  const row = page.getByRole('row', { name: /Severance/ }).first();
  await expect(row).toBeVisible();
  // NFO, poster, fanart, logo: the files are looked for after the scan, not when the page reads.
  await expect(row.getByRole('cell').filter({ hasText: /^✓$/ })).toHaveCount(2);
  await expect(row.getByRole('cell').filter({ hasText: /^✗$/ })).toHaveCount(2);

  await row.getByRole('button', { name: /Show the seasons/ }).click();
  const season = page.getByRole('row', { name: /Season 1/ });
  await expect(season.getByRole('cell').filter({ hasText: /^✓$/ })).toHaveCount(1);

  // What is open stays open after a reload: it is in the address.
  await expect(page).toHaveURL(/open=95396/);
  await page.reload();
  await expect(page.getByRole('row', { name: /Season 1/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Hide the seasons of Severance/ })).toBeVisible();

  // The show lacks its fanart and logo: the filter keeps it, and says how many.
  await page.getByRole('button', { name: /Missing show files\s*1/ }).click();
  await expect(page).toHaveURL(/state=missing-show-files/);
  await expect(page.getByRole('button', { name: /the seasons of Severance/ })).toBeVisible();
});
