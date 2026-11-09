import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { AUTH_HEADERS, incoming } from '../support.js';
import { signIn } from './helpers.js';

// A JPEG header and a mark: what the show's poster is before the user changes it.
const OLD_POSTER = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('old')]);

test('changes the poster and adds a logo of a show from its panel', async ({ page, request }) => {
  const source = incoming('series-images');
  const show = `${source}/Severance (2022) {tmdb-95396}`;
  await mkdir(`${show}/Season 01`, { recursive: true });
  await writeFile(`${show}/Season 01/Severance (2022) - s01e01.mkv`, 'video');
  await writeFile(`${show}/poster.jpg`, OLD_POSTER);
  await writeFile(`${show}/tvshow.nfo`, '<tvshow/>');
  const created = await request.post('/api/libraries', {
    headers: AUTH_HEADERS,
    data: { name: 'Image series', source, type: 'series', naming: 'with-id', metadata: 'nfo' },
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
  await page.getByRole('button', { name: 'Show the seasons of Severance' }).click();

  // The panel of the show offers its three images; no logo yet, so a box invites to add one.
  await expect(page.getByRole('button', { name: 'Change the background' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change the poster' })).toBeVisible();
  await page.getByRole('button', { name: 'Add a logo' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: /Images — Severance \(2022\)/ })).toBeVisible();
  await expect(dialog.getByRole('tab', { name: /Logo/ })).toHaveAttribute('aria-selected', 'true');
  // The folder written is the show's own, never a season's.
  await expect(dialog.getByText(/Severance \(2022\) \{tmdb-95396\}\/$/)).toBeVisible();
  await expect(dialog.getByText(/Season 01/)).toHaveCount(0);

  const grid = dialog.getByRole('list', { name: 'TMDB images' });
  await grid.getByRole('button').first().click();
  await dialog.getByRole('tab', { name: /Poster/ }).click();
  await grid.getByRole('button').first().click();
  await expect(dialog.getByText('2 changes pending: poster.jpg, logo.png')).toBeVisible();
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/Images updated/)).toBeVisible();

  // The files sit beside the show's others; the old poster was replaced.
  expect((await readFile(`${show}/logo.png`)).subarray(1, 4).toString()).toBe('PNG');
  expect((await readFile(`${show}/poster.jpg`)).equals(OLD_POSTER)).toBe(false);
  // The panel read its page again: the logo is a trigger of its own now.
  await expect(page.getByRole('button', { name: 'Change the logo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add a logo' })).toHaveCount(0);
});
