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
  const dune = page.getByRole('row', { name: /Dune/ });

  // The list has no collection column, filter or sort any more: the Collections view has them.
  await expect(page.getByRole('columnheader', { name: 'Collection', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Filters' }).click();
  await expect(page.getByRole('radio', { name: /Incomplete collection/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Films | Collections, with their counts, next to the library's name.
  const views = page.getByRole('radiogroup', { name: 'View' });
  await expect(views.getByRole('radio', { name: /^Movies/ })).toBeChecked();
  await views.getByRole('radio', { name: /^Collections/ }).check();
  await expect(page).toHaveURL(/vue=collections/);

  // The collection TMDB names, with how much of it the library holds, and no image chosen yet.
  const card = page.getByRole('button', { name: /Dune - Saga/ }).first();
  await expect(card).toContainText('1/2');
  await expect(card).toContainText('Servers’ own image');
  await card.click();
  await expect(page).toHaveURL(/collection=tmdb%3A726871/);
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  const detail = page.getByRole('article', { name: 'Dune - Saga' });
  await expect(detail.getByText('TMDB collection #726871 · 1 of 2 in the library')).toBeVisible();
  await expect(detail.getByText('Missing')).toBeVisible();
  // No media server is set up: the choice still works, nothing can be sent.
  await expect(detail.getByText(/No server is set up/)).toBeVisible();

  // The filters keep their counts.
  await expect(page.getByRole('button', { name: /^Incomplete 1$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Custom 0$/ })).toBeVisible();

  // Choosing a poster from TMDB: the dialog of a movie's images, with the tiles as a radio group.
  // The banner and the poster open it too; the Images section has the labelled buttons.
  await detail
    .getByRole('region', { name: 'Images' })
    .getByRole('button', { name: 'Change the poster of Dune - Saga' })
    .click();
  const images = page.getByRole('dialog', { name: 'Images — Dune - Saga' });
  await expect(images.getByRole('tab', { name: /^Poster/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(images.getByRole('tab', { name: /^Background/ })).toBeVisible();
  const origin = images.getByRole('group', { name: 'Where the image comes from' });
  await expect(origin.getByRole('button', { name: 'TMDB' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(origin.getByRole('button', { name: 'Movies of the collection' })).toBeVisible();
  const tiles = images.getByRole('radiogroup', { name: 'TMDB images' });
  await expect(tiles.getByRole('radio')).toHaveCount(2);
  await tiles.getByRole('radio').first().click();
  await expect(tiles.getByRole('radio').first()).toBeChecked();
  await images.getByRole('button', { name: 'Apply' }).click();
  await expect(images).toBeHidden();
  await expect(
    page.getByRole('status').filter({ hasText: 'Image chosen for Dune - Saga' }),
  ).toBeVisible();
  await expect(card).toContainText('Image chosen');
  await expect(detail.getByText('TMDB · English')).toBeVisible();

  // "Show the movies" goes back to the list narrowed to the collection, as a pill to remove.
  await detail.getByRole('button', { name: 'Show the movies' }).click();
  await expect(
    page.getByRole('button', { name: 'Remove the filter Collection: Dune - Saga' }),
  ).toBeVisible();
  await expect(page.getByRole('row', { name: /Alien/ })).toHaveCount(0);
  await expect(page.getByRole('row', { name: /Dune/ })).toBeVisible();
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(page.getByRole('row', { name: /Alien/ })).toBeVisible();

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
  await expect(page.getByText('Univers Arrakis').first()).toBeVisible();

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

  // "Show the collection" opens the Collections view on the film's own collection, a custom one.
  await dune.getByRole('button', { name: /^Dune$/ }).click();
  await page.getByRole('button', { name: 'Show the collection' }).click();
  await expect(page).toHaveURL(/vue=collections&collection=custom%3Afilms%20de%20sable/);
  const custom = page.getByRole('article', { name: 'Films de sable' });
  await expect(custom.getByText('Custom collection · 2 movies')).toBeVisible();
  // Its images come from its movies, not from TMDB, which does not know it.
  await custom
    .getByRole('region', { name: 'Images' })
    .getByRole('button', { name: 'Change the poster of Films de sable' })
    .click();
  const choosing = page.getByRole('dialog', { name: 'Images — Films de sable' });
  const choosingOrigin = choosing.getByRole('group', { name: 'Where the image comes from' });
  await expect(choosingOrigin.getByRole('button', { name: 'TMDB' })).toBeDisabled();
  await expect(
    choosingOrigin.getByRole('button', { name: 'Movies of the collection' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');

  // Renaming rewrites every NFO, after a confirmation that says how many.
  await custom.getByRole('button', { name: 'Rename the collection…' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename “Films de sable”' });
  await rename.getByLabel('Collection name').fill('Sables');
  await rename.getByRole('button', { name: 'Continue' }).click();
  await expect(rename.getByText(/2 NFO will be rewritten/)).toBeVisible();
  await rename.getByRole('button', { name: /^Rename and rewrite 2 NFO/ }).click();
  await expect(rename).toBeHidden();
  await expect(page).toHaveURL(/collection=custom%3Asables/);
  await expect
    .poll(async () => readFile(library('sagas', 'Alien (1979)', 'movie.nfo'), 'utf8'))
    .toContain('<name>Sables</name>');
});
