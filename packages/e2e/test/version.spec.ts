import { access, mkdir, readdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { AUTH_HEADERS, library } from '../support.js';
import { signIn } from './helpers.js';

const FOLDER = library('films', 'Dune (1984) {tmdb-841}');

test('names the version of a movie from its page, with the size picked in the dialog', async ({
  page,
  request,
}) => {
  await mkdir(FOLDER, { recursive: true });
  // Named as the profile wants, but its file name says no size: the owner gives it.
  await writeFile(`${FOLDER}/Dune (1984) {tmdb-841}.mkv`, 'video');
  expect(
    (await request.post('/api/libraries/films/scan', { headers: AUTH_HEADERS })).status(),
  ).toBe(202);

  await signIn(page);
  await page.goto('/libraries/films');
  await page.getByRole('row').filter({ hasText: '1984' }).getByRole('button').click();
  await page.getByRole('button', { name: 'Add the version to the name…' }).click();

  const dialog = page.getByRole('dialog', { name: 'Version naming preview' });
  // Nothing to preview until a size is picked.
  await expect(dialog.getByText('Choose the picture size')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Run' })).toBeDisabled();

  await dialog.getByLabel('Picture size').selectOption('1080p');
  await expect(dialog.getByText('… - 1080p.mkv')).toBeVisible();
  expect(await readdir(FOLDER)).toEqual(['Dune (1984) {tmdb-841}.mkv']);

  await dialog.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Started' })).toBeVisible();
  await expect
    .poll(() =>
      access(`${FOLDER}/Dune (1984) {tmdb-841} - 1080p.mkv`).then(
        () => true,
        () => false,
      ),
    )
    .toBe(true);
});
