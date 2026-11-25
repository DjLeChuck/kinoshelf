import { link, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { AUTH_HEADERS, incoming, library } from '../support.js';
import { signInAt } from './helpers.js';

async function put(path: string, content: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return path;
}

async function create(request: APIRequestContext, data: object): Promise<string> {
  const response = await request.post('/api/libraries', { headers: AUTH_HEADERS, data });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

test('ignores in one click what the library already holds, and keeps the new films', async ({
  page,
  request,
}) => {
  // Two films already in the library, under their own names. Sizes of their own: no other spec's
  // arrival, written as `video`, can look like a copy of them.
  const dune = await put(
    library('present-films', 'Dune (2021) {tmdb-438631}', 'Dune (2021) {tmdb-438631}.mkv'),
    'dune in the library, 28 gigabytes',
  );
  await put(
    library('present-films', 'Alien (1979) {tmdb-348}', 'Alien (1979) {tmdb-348}.mkv'),
    'alien in the library, another size',
  );
  const films = await create(request, {
    name: 'Present films',
    source: library('present-films'),
    type: 'movie',
  });
  // A fresh install: nothing scans the library by hand, and the folder is analysed right after it
  // is made. The scan made with the library comes first, so the duplicates are told.

  // The downloads folder: a hardlink of Dune, a copy of Alien, and a film the library lacks.
  const folder = incoming('present-drop');
  await mkdir(folder, { recursive: true });
  await link(dune, `${folder}/Dune.2021.1080p-LINK.mkv`);
  await put(`${folder}/Alien.1979.2160p-COPY.mkv`, 'alien in the library, another size');
  // The same film in a size the library does not hold: not a duplicate for certain, so it waits to
  // be validated, and its line says the library has the film.
  await put(`${folder}/Alien.1979.1080p-OTHERSIZE.mkv`, 'alien again, in a third size entirely');
  await put(`${folder}/Dune.1984.720p-NEW.mkv`, 'a film the library does not hold yet');
  const drop = await create(request, {
    name: 'Present drop',
    source: folder,
    into: { movie: films },
  });
  try {
    const scan = await request.post(`/api/libraries/${drop}/scan`, { headers: AUTH_HEADERS });
    expect(scan.status()).toBe(202);

    await signInAt(page, '/arrivals?state=present');
    const hardlinked = page.getByRole('button', { name: /Dune\.2021\.1080p-LINK\.mkv/ });
    const copy = page.getByRole('button', { name: /Alien\.1979\.2160p-COPY\.mkv/ });
    await expect(hardlinked).toBeVisible();
    await expect(copy).toBeVisible();
    await expect(hardlinked).toContainText('Already in Present films');

    // The panel says where it is and why.
    await hardlinked.click();
    await expect(page.getByText('Same file (hard link).')).toBeVisible();
    await copy.click();
    await expect(page.getByText(/Same size: /)).toBeVisible();

    // The link opens the page of the film the library holds, not only its list.
    await hardlinked.click();
    await page.getByRole('link', { name: 'Open in the library' }).click();
    await expect(page).toHaveURL(/\/libraries\/.*item=/);
    await expect(page.getByRole('heading', { name: /Dune/ })).toBeVisible();
    await page.goBack();

    // The other size is not in this state, and is told apart where it waits.
    await expect(page.getByRole('button', { name: /OTHERSIZE/ })).toHaveCount(0);
    await page.goto('/arrivals?state=review');
    await expect(page.getByRole('button', { name: /OTHERSIZE/ })).toContainText(
      'Another version in Present films',
    );
    await page.goto('/arrivals?state=present');

    // One click, one confirmation: both leave the state.
    await page
      .getByRole('button', { name: /^Ignore the \d+ files already in the library$/ })
      .click();
    await page.getByRole('dialog').getByRole('button', { name: 'Ignore', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: /files? ignored/ })).toBeVisible();
    await expect(hardlinked).toHaveCount(0);
    await expect(copy).toHaveCount(0);

    // "Ready" keeps the real newcomer, and neither duplicate was ever in it.
    await page.goto('/arrivals?state=ready');
    await expect(page.getByRole('button', { name: /Dune\.1984\.720p-NEW\.mkv/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /LINK|COPY/ })).toHaveCount(0);
  } finally {
    await request.delete(`/api/libraries/${drop}`, { headers: AUTH_HEADERS });
    await request.delete(`/api/libraries/${films}`, { headers: AUTH_HEADERS });
  }
});
