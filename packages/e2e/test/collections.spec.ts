import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { AUTH_HEADERS, library } from '../support.js';
import { signIn } from './helpers.js';

const DUNE = library('sagas', 'Dune (2021)', 'Dune (2021).mkv');
const ALIEN = library('sagas', 'Alien (1979)', 'Alien (1979).mkv');

test('files movies under collections: the list, the page of a film, a whole selection', async ({
  page,
  request,
}) => {
  for (const file of [DUNE, ALIEN]) {
    await mkdir(file.slice(0, file.lastIndexOf('/')), { recursive: true });
    await writeFile(file, 'video');
  }
  const created = await request.post('/api/libraries', {
    headers: AUTH_HEADERS,
    data: {
      name: 'Sagas',
      source: library('sagas'),
      type: 'movie',
      naming: 'no-id',
      metadata: 'nfo',
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  expect(
    (await request.post(`/api/libraries/${id}/scan`, { headers: AUTH_HEADERS })).status(),
  ).toBe(202);
  const items = async () =>
    (
      (await (
        await request.get(`/api/libraries/${id}/items`, { headers: AUTH_HEADERS })
      ).json()) as { scannedAt: string | null; items: { id: string }[] }
    ).items;
  await expect.poll(async () => (await items()).length).toBe(2);
  // The NFO is written by Kinoshelf, as the owner would have it: through a refresh.
  const refreshed = await request.post(`/api/libraries/${id}/execute`, {
    headers: AUTH_HEADERS,
    data: { items: (await items()).map((item) => item.id) },
  });
  expect(refreshed.status()).toBe(202);
  await expect
    .poll(async () =>
      readFile(library('sagas', 'Dune (2021)', 'movie.nfo'), 'utf8').catch(() => ''),
    )
    .toContain('<set tmdbcolid="726871">');

  await signIn(page);
  await page.goto(`/libraries/${id}`);

  // The collection TMDB names, with how much of it the library holds.
  const dune = page.getByRole('row', { name: /Dune/ });
  await expect(dune.getByRole('button', { name: /Dune - Saga/ })).toBeVisible();
  await expect(dune.getByText('1/2')).toBeVisible();
  await expect(page.getByRole('row', { name: /Alien/ })).toBeVisible();

  // Filtering by collection, from the panel and from a name in the list; each is a pill to remove.
  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByRole('radio', { name: /^Incomplete collection/ }).check();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /^Filters/ })).toBeFocused();
  await expect(page.getByRole('button', { name: /^Filters, 1 active filter$/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Alien/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove the filter Incomplete collection' }).click();
  await expect(page.getByRole('row', { name: /Alien/ })).toBeVisible();
  await dune.getByRole('button', { name: /Show only the collection Dune - Saga/ }).click();
  await expect(
    page.getByRole('button', { name: 'Remove the filter Collection: Dune - Saga' }),
  ).toBeVisible();
  await expect(page.getByRole('row', { name: /Alien/ })).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: '1 of 2 movies' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(page.getByRole('row', { name: /Alien/ })).toBeVisible();

  // Sorting is the header's: a first click reads the collections upwards, a line names each group.
  const header = page.getByRole('columnheader', { name: 'Collection', exact: true });
  await header.getByRole('button').click();
  await expect(header).toHaveAttribute('aria-sort', 'ascending');
  await expect(page.getByRole('columnheader', { name: 'Title' })).not.toHaveAttribute('aria-sort');
  await expect(page.getByRole('row', { name: 'Dune - Saga · 1 of 2', exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: 'No collection', exact: true })).toBeVisible();
  // The explanation is a tooltip, not a sentence under the list.
  await expect(header).toHaveAttribute('title', /each saga by year/);
  await header.getByRole('button').click();
  await expect(header).toHaveAttribute('aria-sort', 'descending');

  // The page of the film: the collection is a fact, and its edition is a dialog, not a block.
  await dune.getByRole('button', { name: /^Dune$/ }).click();
  await expect(page.getByRole('region', { name: 'Collection' })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: /TMDB collection/ })).toHaveCount(0);
  const edit = page.getByRole('button', { name: 'Edit the collection Dune - Saga' });
  await expect(edit).toBeVisible();

  // Escape closes it without changing anything, and the focus goes back to the button.
  await edit.click();
  const section = page.getByRole('dialog', { name: 'Collection — Dune (2021)' });
  await expect(section.getByText('Currently: Dune - Saga (TMDB)')).toBeVisible();
  await expect(section.getByRole('radio', { name: 'TMDB collection: Dune - Saga' })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(section).toBeHidden();
  await expect(edit).toBeFocused();

  // TMDB's saga, with the film it lacks.
  await edit.click();
  await expect(section.getByText('Missing').first()).toBeVisible();
  await expect(section.getByRole('link', { name: /Open Dune : Part Two on TMDB/ })).toBeVisible();
  await expect(
    section.getByText('<set tmdbcolid="726871"><name>Dune - Saga</name></set>'),
  ).toBeVisible();

  // Nothing to apply until something changes, nor a custom collection without its name.
  const apply = section.getByRole('button', { name: 'Apply' });
  await expect(apply).toBeDisabled();
  await section.getByRole('radio', { name: 'Custom collection' }).check();
  await expect(apply).toBeDisabled();
  await section.getByLabel('Collection name').fill('Univers Arrakis');
  await expect(section.getByText('<set><name>Univers Arrakis</name></set>')).toBeVisible();
  await apply.click();
  await expect(section).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: '1 NFO rewritten' })).toBeVisible();
  await expect
    .poll(async () => readFile(library('sagas', 'Dune (2021)', 'movie.nfo'), 'utf8'))
    .toContain('<name>Univers Arrakis</name>');
  await expect(dune.getByText('Custom', { exact: true })).toBeVisible();

  // A whole selection at once, from the bar.
  await page.getByRole('checkbox', { name: /Select all/ }).check();
  await page.getByRole('button', { name: 'Set the collection…' }).click();
  const bulk = page.getByRole('dialog', { name: 'Collection of 2 movies' });
  // The same dialog for several movies: nothing chosen beforehand, no saga and no preview.
  await expect(bulk.getByRole('radio', { name: /Each movie’s TMDB collection/ })).not.toBeChecked();
  await expect(bulk.getByText('2 movies concerned')).toBeVisible();
  await expect(bulk.getByText('Written in the NFO')).toHaveCount(0);
  const bulkApply = bulk.getByRole('button', { name: 'Apply' });
  await expect(bulkApply).toBeDisabled();
  await bulk.getByRole('radio', { name: 'Custom collection' }).check();
  await bulk.getByLabel('Collection name').fill('Films de sable');
  await bulkApply.click();
  await expect(bulk).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: '2 NFOs rewritten' })).toBeVisible();
  await expect
    .poll(async () => readFile(library('sagas', 'Alien (1979)', 'movie.nfo'), 'utf8'))
    .toContain('<name>Films de sable</name>');
});
