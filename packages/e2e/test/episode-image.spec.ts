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
  await writeFile(`${season}/Severance (2022) - s01e01 - 1080p.jpg`, OLD);
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

  // The NFO is the episode's too: one status and one button for the two versions, none on a card.
  const nfo = page.getByRole('region', { name: 'NFO' });
  await expect(nfo.locator('.state')).toContainText('missing');
  // With several versions, the status names the ones that lack theirs.
  await expect(nfo.getByText(/s01e01 - (1080p|2160p)\.nfo/)).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Generate the missing NFO…' })).toHaveCount(1);
  await expect(
    page.getByRole('region', { name: 'Versions' }).getByRole('button', { name: /NFO/ }),
  ).toHaveCount(0);

  // The one button asks for the two versions at once.
  await page.getByRole('button', { name: 'Generate the missing NFO…' }).click();
  const preview = page.getByRole('dialog', { name: 'Refresh preview' });
  await expect(preview).toBeVisible();
  // The show folds its episodes, and each one its other files.
  await preview.locator('details.group > summary').click();
  await expect(preview.getByText(/other file/)).toHaveCount(2);
  for (const more of await preview.getByText(/other file/).all()) {
    await more.click();
  }
  await expect(preview.getByText(/s01e01 - 1080p\.nfo/)).toBeVisible();
  await expect(preview.getByText(/s01e01 - 2160p\.nfo/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(preview).toBeHidden();

  // The panel has one image for the episode, not one per version, and a button to change it.
  const panel = page.getByRole('region', { name: 'Thumbnail' });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Change the image' }).click();

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
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Change the image' })).toBeVisible();
  await expect(panel.getByText('present')).toBeVisible();

  // Both versions hold the same new picture; the old one was replaced.
  const [hd, uhd] = await Promise.all([
    readFile(`${season}/Severance (2022) - s01e01 - 1080p.jpg`),
    readFile(`${season}/Severance (2022) - s01e01 - 2160p.jpg`),
  ]);
  expect(hd.equals(OLD)).toBe(false);
  expect(hd.equals(uhd)).toBe(true);
});
