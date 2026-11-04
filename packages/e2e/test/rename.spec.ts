import { access, mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { AUTH_HEADERS, library } from '../support.js';
import { signIn } from './helpers.js';

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );
const ALIEN = library('films', 'Alien (1979) {tmdb-348}', 'Alien (1979) {tmdb-348} - 1080p.mkv');

test('previews a rename from the library, runs it, and finds it in the history', async ({
  page,
  request,
}) => {
  await mkdir(library('films'), { recursive: true });
  await writeFile(library('films', 'Alien.1979.1080p.mkv'), 'video');
  expect(
    (await request.post('/api/libraries/films/scan', { headers: AUTH_HEADERS })).status(),
  ).toBe(202);

  await signIn(page);
  await page.goto('/libraries/films');
  await page.getByRole('checkbox', { name: /Select Alien/ }).check();
  await page.getByRole('button', { name: 'Rename…' }).click();

  // The dialog says what would happen, and nothing was written yet.
  const dialog = page.getByRole('dialog', { name: 'Rename preview' });
  // The folder is told once and the file's name drops what the folder already says.
  await expect(dialog.getByText('Alien (1979) {tmdb-348}/')).toBeVisible();
  await expect(dialog.getByText('… - 1080p.mkv')).toBeVisible();
  expect(await exists(ALIEN)).toBe(false);

  await dialog.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Started' })).toBeVisible();
  await expect.poll(() => exists(ALIEN)).toBe(true);

  await page.getByRole('link', { name: 'History' }).click();
  await expect(page.getByText(/Alien/).first()).toBeVisible();
});
