import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { AUTH_HEADERS, incoming } from '../support.js';
import { signIn } from './helpers.js';

test('reads a series held in two versions, one of them short of an episode', async ({
  page,
  request,
}) => {
  const folder = incoming('series-versions');
  const season = `${folder}/Severance (2022) {tmdb-95396}/Season 01`;
  await mkdir(season, { recursive: true });
  // 1080p holds both episodes, 2160p only the first.
  for (const name of ['s01e01 - 1080p', 's01e01 - 2160p', 's01e02 - 1080p']) {
    await writeFile(`${season}/Severance (2022) - ${name}.mkv`, 'video');
  }
  const created = await request.post('/api/libraries', {
    headers: AUTH_HEADERS,
    data: { name: 'Two versions', source: folder, type: 'series', naming: 'with-id' },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  expect(
    (await request.post(`/api/libraries/${id}/scan`, { headers: AUTH_HEADERS })).status(),
  ).toBe(202);

  await signIn(page);
  await page.goto(`/libraries/${id}`);

  // One line for the show: two distinct episodes, in two versions, the short one with its ratio.
  const row = page.getByRole('row', { name: /Severance/ }).first();
  await expect(row.getByText('×2')).toBeVisible();
  await expect(row.getByText('1080p', { exact: true })).toBeVisible();
  await expect(row.getByText('2160p 1/2')).toBeVisible();

  // The filter keeps the show, and counts it.
  await page.getByRole('button', { name: /Incomplete versions\s*1/ }).click();
  await expect(page).toHaveURL(/state=incomplete-versions/);
  await expect(row).toBeVisible();

  // The season says it per version; its episodes are listed once.
  await row.getByRole('button', { name: /Show the seasons/ }).click();
  const seasonRow = page.getByRole('row', { name: /Season 1/ });
  await expect(seasonRow.getByText('1080p 2/2')).toBeVisible();
  await expect(seasonRow.getByText('2160p 1/2')).toBeVisible();
  await seasonRow.getByRole('button', { name: /Season 1/ }).click();
  await expect(page.getByRole('row', { name: /S01E0[12]/ })).toHaveCount(2);

  // The second episode has no 2160p: its badge says so, and its panel holds the table of the one it has.
  const second = page.getByRole('row', { name: /S01E02/ });
  await expect(second.getByText(': Version absent')).toBeAttached();
  await second.getByRole('button', { name: /S01E02/ }).click();
  const versions = page.getByRole('region', { name: /^Versions/ });
  await expect(versions.getByRole('columnheader', { name: '1080p' })).toBeVisible();
  await expect(versions.getByRole('columnheader', { name: '2160p' })).toHaveCount(0);
  await expect(versions.getByText('Complete')).toBeVisible();
  await expect(versions.getByText('Severance (2022) - s01e02 - 1080p.mkv')).toBeVisible();
  // No button on an episode: it is analysed and matched with its series or its season.
  await expect(
    page.getByText('Reanalysis and matching are done on the series or the season.'),
  ).toBeVisible();

  // The show's panel draws the coverage: a line per version, a square per episode.
  // From an episode, the show's row opens the show's panel without folding the tree.
  await row.getByRole('button', { name: /Hide the seasons/ }).click();
  await expect(page.getByRole('row', { name: /S01E02/ })).toBeVisible();
  const coverage = page.getByRole('region', { name: /^Versions/ });
  await expect(coverage.getByText('2/2')).toBeVisible();
  await expect(coverage.getByText('1/2')).toBeVisible();
  await expect(coverage.getByText('Episode 2 · 2160p: Version absent')).toBeAttached();
});
