import { access } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { library } from '../support.js';
import { signIn, submit } from './helpers.js';

const ALIEN = library('Alien (1979) {tmdb-348}', 'Alien (1979) {tmdb-348}.mkv');

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

test('lists a batch, previews its undo, then undoes it', async ({ page, request }) => {
  // A file that matches with confidence is transferred at once, in a batch of its own.
  await submit(request, 'history-undo', ['Alien.1979.1080p.mkv'], true);
  await expect.poll(() => exists(ALIEN)).toBe(true);

  await signIn(page);
  await page.getByRole('link', { name: 'History' }).click();
  await expect(page.getByText('Alien.1979.1080p.mkv').first()).toBeVisible();

  await page.getByRole('button', { name: 'Undo this batch' }).click();
  await expect(page.getByText('Will be restored')).toBeVisible();
  // Looking is not doing: nothing moved yet.
  expect(await exists(ALIEN)).toBe(true);

  await page.getByRole('button', { name: 'Confirm the undo' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Batch undone' })).toBeVisible();
  await expect.poll(() => exists(ALIEN)).toBe(false);
  await expect(page.getByText('This batch was undone.')).toBeVisible();
});
