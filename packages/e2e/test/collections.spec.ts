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

  // Filtering by collection, from the group of buttons and from a name in the list.
  await page.getByRole('button', { name: /^Incomplete collection/ }).click();
  await expect(page.getByRole('row', { name: /Alien/ })).toHaveCount(0);
  await page.getByRole('button', { name: /^All/ }).first().click();
  await dune.getByRole('button', { name: /Show only the collection Dune - Saga/ }).click();
  await expect(
    page.getByRole('button', { name: 'Remove the filter on the collection Dune - Saga' }),
  ).toBeVisible();
  await expect(page.getByRole('row', { name: /Alien/ })).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Remove the filter on the collection Dune - Saga' })
    .click();
  // The sort's radios are visually hidden: a person clicks the label, so the test does too.
  await page.getByRole('group', { name: 'Sort by' }).getByText('Collection').click();
  await expect(page.getByRole('radio', { name: 'Collection', exact: true })).toBeChecked();
  await expect(page.getByRole('row')).toHaveCount(3);

  // The page of the film: TMDB's saga, with the film it lacks.
  await dune.getByRole('button', { name: /^Dune$/ }).click();
  const section = page.getByRole('region', { name: 'Collection' });
  await expect(section.getByRole('radio', { name: 'TMDB collection: Dune - Saga' })).toBeChecked();
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
  await expect(page.getByRole('status').filter({ hasText: 'NFO rewritten: 1' })).toBeVisible();
  await expect
    .poll(async () => readFile(library('sagas', 'Dune (2021)', 'movie.nfo'), 'utf8'))
    .toContain('<name>Univers Arrakis</name>');
  await expect(dune.getByText('Custom', { exact: true })).toBeVisible();

  // A whole selection at once, from the bar.
  await page.getByRole('checkbox', { name: /Select all/ }).check();
  await page.getByRole('button', { name: 'Set the collection…' }).click();
  const bulk = page.getByRole('region', { name: 'Set the collection of the selection (2)' });
  await bulk.getByLabel('Collection name').fill('Films de sable');
  await bulk.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'NFO rewritten: 2' })).toBeVisible();
  await expect
    .poll(async () => readFile(library('sagas', 'Alien (1979)', 'movie.nfo'), 'utf8'))
    .toContain('<name>Films de sable</name>');
});
