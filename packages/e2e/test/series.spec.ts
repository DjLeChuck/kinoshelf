import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { AUTH_HEADERS, incoming, library } from '../support.js';
import { scanLibrary, signIn } from './helpers.js';

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

  // The count is made in the background, then shown on the line of the show (the number alone,
  // the column says what it counts; the tooltip spells it out).
  await page
    .getByRole('row', { name: /Severance/ })
    .locator('.chip-warn', { hasText: /^1$/ })
    .hover();
  await expect(page.getByRole('tooltip')).toHaveText('Missing: 1');

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
  await page.getByRole('button', { name: 'Organize…' }).click();

  // One preview for the three episodes, nothing picked one by one.
  const dialog = page.getByRole('dialog', { name: 'Organize preview' });
  await expect(dialog.getByText(/[3-9] to move/)).toBeVisible();
});

test('refreshes a show that only lacks files of its own', async ({ page, request }) => {
  const folder = incoming('series-refresh');
  const show = `${folder}/Severance (2022) {tmdb-95396}`;
  await mkdir(`${show}/Season 01`, { recursive: true });
  await writeFile(`${show}/Season 01/Severance (2022) - s01e01.mkv`, 'video');
  // The episode has its own NFO, so nothing is wrong with it; the show lacks its fanart.
  for (const name of [
    'Season 01/Severance (2022) - s01e01.nfo',
    'tvshow.nfo',
    'poster.jpg',
    'season01-poster.jpg',
  ]) {
    await writeFile(`${show}/${name}`, 'x');
  }
  const created = await request.post('/api/libraries', {
    headers: AUTH_HEADERS,
    data: {
      name: 'Refresh series',
      source: folder,
      type: 'series',
      naming: 'with-id',
      metadata: 'nfo',
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  await scanLibrary(request, id);

  await signIn(page);
  await page.goto(`/libraries/${id}`);
  // Only the show's own files are missing, and still there is a box to refresh them with.
  await page.getByRole('checkbox', { name: /Select Severance/ }).check();
  await page.getByRole('button', { name: 'Complete…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Missing files preview' });
  await expect(dialog.getByText(/[1-9]\d* to write/)).toBeVisible();
});

test('shows which NFO and images a show and its seasons have', async ({ page, request }) => {
  const folder = incoming('series-files');
  const show = `${folder}/Severance (2022) {tmdb-95396}`;
  await mkdir(`${show}/Season 01`, { recursive: true });
  await writeFile(`${show}/Season 01/Severance (2022) - s01e01.mkv`, 'video');
  // The show has its NFO and poster, the season its poster (beside the show's files); the fanart
  // and the logo are missing.
  for (const name of ['tvshow.nfo', 'poster.jpg', 'season01-poster.jpg']) {
    await writeFile(`${show}/${name}`, 'x');
  }
  const created = await request.post('/api/libraries', {
    headers: AUTH_HEADERS,
    data: {
      name: 'Jelly series',
      source: folder,
      type: 'series',
      naming: 'with-id',
      metadata: 'nfo',
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  await scanLibrary(request, id);

  await signIn(page);
  await page.goto(`/libraries/${id}`);
  const row = page.getByRole('row', { name: /Severance/ }).first();
  await expect(row).toBeVisible();
  // NFO, poster, fanart, logo: the files are looked for after the scan, not when the page reads.
  // The show's NFO is there, but its one episode has none of its own: the orange count says so.
  await expect(row.getByRole('cell').filter({ hasText: /^✓ present\s*1 ep\.\s*$/ })).toHaveCount(1);
  await expect(row.getByRole('cell').filter({ hasText: /^✓ present$/ })).toHaveCount(1);
  await expect(row.getByRole('cell').filter({ hasText: /^✗ missing$/ })).toHaveCount(2);

  await row.getByRole('button', { name: /Show the seasons/ }).click();
  const season = page.getByRole('row', { name: /Season 1/ });
  await expect(season.getByRole('cell').filter({ hasText: /^✓ present$/ })).toHaveCount(1);

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

test('drops the tick columns on a phone, so the tree needs no sideways scroll', async ({
  page,
  request,
}) => {
  const folder = incoming('series-phone');
  const show = `${folder}/Severance (2022) {tmdb-95396}`;
  await mkdir(`${show}/Season 01`, { recursive: true });
  await writeFile(`${show}/Season 01/Severance (2022) - s01e01.mkv`, 'video');
  const created = await request.post('/api/libraries', {
    headers: AUTH_HEADERS,
    data: { name: 'Phone series', source: folder, type: 'series', metadata: 'nfo' },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  await scanLibrary(request, id);

  await page.setViewportSize({ width: 390, height: 800 });
  await signIn(page);
  await page.goto(`/libraries/${id}`);
  await expect(page.getByRole('row', { name: /Severance/ }).first()).toBeVisible();

  // The columns are gone from the page, not only hidden by a scroll.
  for (const name of ['NFO', 'Poster', 'Fanart', 'Logo']) {
    await expect(page.getByRole('columnheader', { name, exact: true })).toHaveCount(0);
  }
  // The year and the seasons go too (the panel and the season rows say them); the title stays.
  for (const name of ['Year', 'Seasons']) {
    await expect(page.getByRole('columnheader', { name, exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole('columnheader', { name: 'Title' })).toBeVisible();
  const overflow = await page.evaluate<number>(
    "(() => { const wrap = document.querySelector('table').parentElement; return wrap.scrollWidth - wrap.clientWidth; })()",
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // The page of a show is a sheet over the list: it has its own close button, and closing it
  // gives the list back.
  // Opening the seasons leaves the tree in view; the show's page has a button of its own.
  await page.getByRole('button', { name: /Show the seasons of Severance/ }).click();
  await expect(page.getByRole('button', { name: 'Close the page' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open the page of Severance' }).click();
  const close = page.getByRole('button', { name: 'Close the page' });
  await expect(close).toBeVisible();
  await expect(close.locator('xpath=ancestor::div[contains(@class, "side")]')).toHaveCSS(
    'position',
    'fixed',
  );
  // The list behind it does not scroll.
  await expect(page.locator('html')).toHaveCSS('overflow', 'hidden');
  await close.click();
  await expect(close).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveCSS('overflow', 'hidden');

  // Back on a desktop width, they return.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByRole('columnheader', { name: 'NFO', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Year', exact: true })).toBeVisible();
});
