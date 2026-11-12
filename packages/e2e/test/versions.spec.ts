import { mkdir, rm, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { AUTH_HEADERS, library } from '../support.js';
import { signIn } from './helpers.js';

const FOLDER = library('films', 'Dune (1984) {tmdb-841}');

test('lists a movie held in two versions once', async ({ page, request }) => {
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

  // One line, a badge per version.
  const row = page.getByRole('row').filter({ hasText: '1984' });
  await expect(row).toHaveCount(1);
  await expect(row.getByText('1080p')).toBeVisible();
  await expect(row.getByText('2160p')).toBeVisible();

  // The versions are told apart on the movie's page, not by folding the list.
  await expect(page.getByRole('button', { name: /versions of/ })).toHaveCount(0);

  // The filter counts the movie, once.
  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByRole('button', { name: /Several versions/ }).click();
  await expect(page).toHaveURL(/multi=1/);
  await expect(page.getByRole('group', { name: 'Active filters' })).toContainText(
    'Several versions',
  );
  await expect(page.getByRole('row').filter({ hasText: '1984' })).toHaveCount(1);
  await page.keyboard.press('Escape');

  // The panel compares the versions, each with the state of its NFO, without a tally.
  await row.locator('button.link').click();
  const panel = page.getByRole('region', { name: /^Versions/ });
  await expect(panel.getByRole('heading')).toContainText('· 2');
  await expect(panel.getByRole('columnheader', { name: '2160p' })).toBeVisible();
  await expect(panel.getByRole('row', { name: /File/ })).toContainText('- 1080p.mkv');
  // Each version says whether its own NFO is there.
  await expect(panel.getByRole('row', { name: /Status/ }).getByText('Complete')).toHaveCount(2);
  // The file lines are gone from the facts: the path is the folder's, the files are in the table.
  await expect(page.getByRole('term').filter({ hasText: /^File$/ })).toHaveCount(0);
  await expect(page.getByText(/expected/)).toHaveCount(0);
  await patch(null);
});
