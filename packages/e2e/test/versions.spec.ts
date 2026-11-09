import { mkdir, rm, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { AUTH_HEADERS, library } from '../support.js';
import { signIn } from './helpers.js';

const FOLDER = library('films', 'Dune (1984) {tmdb-841}');

test('lists a movie held in two versions once, and unfolds them', async ({ page, request }) => {
  // What a spec before this one left in the folder would be a third version.
  await rm(FOLDER, { recursive: true, force: true });
  await mkdir(FOLDER, { recursive: true });
  await writeFile(`${FOLDER}/Dune (1984) {tmdb-841} - 1080p.mkv`, 'hd');
  await writeFile(`${FOLDER}/Dune (1984) {tmdb-841} - 2160p.mkv`, 'the bigger one');
  await writeFile(`${FOLDER}/movie.nfo`, '<movie/>');
  // The library writes NFO for this spec (so a column and a count exist), and goes back after it.
  const patch = (metadata: string | null) =>
    request.patch('/api/libraries/films', { headers: AUTH_HEADERS, data: { metadata } });
  expect((await patch('nfo')).status()).toBe(200);
  expect(
    (await request.post('/api/libraries/films/scan', { headers: AUTH_HEADERS })).status(),
  ).toBe(202);

  await signIn(page);
  await page.goto('/libraries/films');

  // One line, a badge per version; the versions are folded away.
  const row = page.getByRole('row').filter({ hasText: '1984' });
  await expect(row).toHaveCount(1);
  await expect(row.getByText('1080p')).toBeVisible();
  await expect(row.getByText('2160p')).toBeVisible();

  const toggle = row.getByRole('button', { name: 'Show the versions of Dune' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(row.getByRole('button', { name: 'Hide the versions of Dune' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  // A sub-row per version.
  await expect(page.locator('tr.version')).toHaveCount(2);

  // The filter counts the movie, once.
  await page.getByRole('button', { name: /Several versions/ }).click();
  await expect(page).toHaveURL(/state=multi-version/);
  await expect(page.getByRole('row').filter({ hasText: '1984' })).toHaveCount(1);

  // The panel compares the versions and lists the one NFO the profile expects, without a tally.
  await row.locator('button.link').click();
  const panel = page.getByRole('region', { name: 'Compare the versions' });
  await expect(panel.getByRole('columnheader', { name: '2160p' })).toBeVisible();
  await expect(panel.getByRole('row', { name: /File/ })).toContainText('- 1080p.mkv');
  await expect(page.getByText('movie.nfo')).toBeVisible();
  await expect(page.getByText(/expected/)).toHaveCount(0);
  await patch(null);
});
