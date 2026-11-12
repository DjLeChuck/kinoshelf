import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { AUTH_HEADERS, incoming } from '../support.js';
import { signIn } from './helpers.js';

// A JPEG header and a mark: the image one of the two versions has before the change.
const OLD = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('old')]);

test('changes the one image of an episode held in two versions, for both', async ({
  page,
  request,
}) => {
  const folder = incoming('episode-image');
  const season = `${folder}/Severance (2022) {tmdb-95396}/Season 01`;
  await mkdir(season, { recursive: true });
  for (const name of ['1080p', '2160p']) {
    await writeFile(`${season}/Severance (2022) - s01e01 - ${name}.mkv`, 'video');
  }
  // Only the 1080p copy has its image, and its NFO: the 2160p one gets the new picture too.
  await writeFile(`${season}/Severance (2022) - s01e01 - 1080p-thumb.jpg`, OLD);
  const created = await request.post('/api/libraries', {
    headers: AUTH_HEADERS,
    data: {
      name: 'Episode image',
      source: folder,
      type: 'series',
      naming: 'with-id',
      metadata: 'nfo',
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const scan = await request.post(`/api/libraries/${id}/scan`, { headers: AUTH_HEADERS });
  expect(scan.status()).toBe(202);
  const job = ((await scan.json()) as { id: string }).id;
  await expect
    .poll(
      async () =>
        (
          (await (await request.get(`/api/jobs/${job}`, { headers: AUTH_HEADERS })).json()) as {
            status: string;
          }
        ).status,
    )
    .toBe('done');

  await signIn(page);
  await page.goto(`/libraries/${id}`);
  const row = page.getByRole('row', { name: /Severance/ }).first();
  await row.getByRole('button', { name: /Show the seasons/ }).click();
  await page
    .getByRole('row', { name: /Season 1/ })
    .getByRole('button', { name: /Season 1/ })
    .click();
  const episode = page.getByRole('row', { name: /S01E01/ });
  // One column for the image, a mark for the episode: a version lacks its copy.
  await expect(page.getByRole('columnheader', { name: 'Thumbnail' })).toBeVisible();
  await episode.getByRole('button', { name: /S01E01/ }).click();

  // The metadata line says the NFO is missing, and the table says it for each version.
  await expect(page.getByText('NFO (missing)')).toBeVisible();
  const versions = page.getByRole('region', { name: /^Versions/ });
  await expect(versions.getByRole('row', { name: /Status/ }).getByText('NFO missing')).toHaveCount(
    2,
  );
  // An episode has no button of its own: no generation of the NFO, no rename, no version.
  await expect(page.getByRole('button', { name: 'Generate the missing NFO…' })).toHaveCount(0);
  await expect(versions.getByRole('button')).toHaveCount(0);

  // The panel has one image for the episode, not one per version, and a button to change it.
  // The fake picture does not decode, so the browser may already have fallen back to "Add an image".
  const thumb = page.getByRole('button', { name: /Change the image|Add an image/ });
  await expect(thumb).toBeVisible();
  await thumb.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: /Images — Severance — S01E01/ })).toBeVisible();
  // A single kind of image: the tabs are not shown.
  await expect(dialog.getByRole('tablist')).toBeHidden();
  await expect(dialog.getByText(/for every version of the episode/)).toBeVisible();
  await dialog.getByRole('list', { name: 'TMDB images' }).getByRole('button').first().click();
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/Images updated/)).toBeVisible();
  // The episode stays selected, and its panel follows: the picture is there for every version now.
  await expect(page.getByRole('row', { name: /S01E01/ })).toHaveClass(/current/);
  await expect(thumb).toBeVisible();
  await expect(page.getByText('Thumbnail (missing)')).toHaveCount(0);

  // Both versions hold the same new picture; the old one was replaced.
  const [hd, uhd] = await Promise.all([
    readFile(`${season}/Severance (2022) - s01e01 - 1080p-thumb.jpg`),
    readFile(`${season}/Severance (2022) - s01e01 - 2160p-thumb.jpg`),
  ]);
  expect(hd.equals(OLD)).toBe(false);
  expect(hd.equals(uhd)).toBe(true);
});
