import { access } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { AUTH_HEADERS, library } from '../support.js';
import { signIn, signInAt, submit } from './helpers.js';

const ALIEN = library('films', 'Alien (1979) {tmdb-348}', 'Alien (1979) {tmdb-348} - 1080p.mkv');

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

test('lists a failed job with its cause, and sends it again', async ({ page, request }) => {
  const path = '/no/such/history-failed';
  const created = await request.post('/api/jobs', {
    headers: AUTH_HEADERS,
    data: { path },
  });
  expect(created.status()).toBe(202);

  await signIn(page);
  await page.getByRole('link', { name: 'History' }).click();
  await page
    .getByRole('button', { name: new RegExp(path) })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Cause' })).toBeVisible();
  // The detail says the cause in words, not as a generic failure (the list line already did).
  await expect(page.getByRole('alert').filter({ hasText: 'Cause' })).toContainText(
    `Path not found: ${path}`,
  );
  await page.getByRole('button', { name: 'Show the technical detail' }).click();
  await expect(page.locator('pre')).toContainText('discover.not-found');

  const before = page.url();
  await page.getByRole('button', { name: 'Send again' }).click();
  // The new job is the line to follow.
  await expect(page).not.toHaveURL(before);
});

test('keeps the routine analyses out of the list until asked', async ({ page, request }) => {
  // Nothing matches with confidence and nothing is applied: the job ends having moved nothing.
  await submit(request, 'history-routine', ['Zzzqx.Unknown.Title.2001.mkv']);

  await signIn(page);
  await page.getByRole('link', { name: 'History' }).click();
  const routine = page.getByRole('button', { name: /history-routine/ });
  await expect(routine).toHaveCount(0);

  await page.getByLabel('Show every analysis').check();
  await expect(routine.first()).toBeVisible();
});

test('opens a line linked to even when the list does not show it', async ({ page, request }) => {
  // A routine analysis is left out of the default list, yet a link may lead to it.
  const id = await submit(request, 'history-linked', ['Zzzqx.Linked.Title.2002.mkv']);

  await signInAt(page, `/history/${id}`);
  await expect(page.getByRole('heading', { name: /history-linked/ })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/history/${id}$`));
});
