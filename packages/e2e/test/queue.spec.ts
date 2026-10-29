import { access } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { library } from '../support.js';
import { signIn, submit } from './helpers.js';

// One test settles the library the next one reads: they run in this order.
test.describe.configure({ mode: 'serial' });

const DUNE_TARGET = library('Dune (2021) {tmdb-438631}', 'Dune (2021) {tmdb-438631}.mkv');

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

test('validates a file with a candidate found by hand, and the transfer happens', async ({
  page,
  request,
}) => {
  await submit(request, 'queue-validate', ['Mystery.Home.Video.mkv']);
  await signIn(page);

  const item = page.getByRole('button', { name: /Mystery\.Home\.Video\.mkv/ });
  await item.click();
  await expect(page.getByText('Nothing found').first()).toBeVisible();

  await page.getByRole('searchbox', { name: 'Title' }).fill('Dune');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('radio', { name: /Dune \(2021\)/ }).check({ force: true });

  await expect(page.getByText(DUNE_TARGET)).toBeVisible();
  await page.getByRole('button', { name: 'Validate', exact: true }).click();

  await expect(page.getByRole('status').filter({ hasText: 'Transfer started' })).toBeVisible();
  await expect.poll(() => exists(DUNE_TARGET)).toBe(true);
  await expect(item).toHaveCount(0);
});

test('shows the poster of a candidate through the server, never from TMDB', async ({
  page,
  request,
}) => {
  await submit(request, 'queue-poster', ['Mystery.Poster.Check.mkv']);
  const outside: string[] = [];
  page.on('request', (r) => {
    const { hostname } = new URL(r.url());
    if (hostname !== '127.0.0.1') {
      outside.push(r.url());
    }
  });
  await signIn(page);
  await page.getByRole('button', { name: /Mystery\.Poster\.Check\.mkv/ }).click();
  await page.getByRole('searchbox', { name: 'Title' }).fill('Dune');
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  const poster = page.locator('img[src^="/api/images/w92/"]').first();
  await expect(poster).toBeVisible();
  // Rendered, not just present: a broken image has no width.
  await expect(poster).not.toHaveJSProperty('naturalWidth', 0);
  expect(outside).toEqual([]);
});

test('refuses a choice whose destination is already taken', async ({ page, request }) => {
  await submit(request, 'queue-conflict', ['Another.Unknown.File.mkv']);
  await signIn(page);

  await page.getByRole('button', { name: /Another\.Unknown\.File\.mkv/ }).click();
  await page.getByRole('searchbox', { name: 'Title' }).fill('Dune');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('radio', { name: /Dune \(2021\)/ }).check({ force: true });

  // The first test put a file there: the plan says so and nothing is offered to overwrite it.
  await expect(page.getByText('the destination already exists')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Validate', exact: true })).toBeDisabled();
});

test('sets a file aside without touching it', async ({ page, request }) => {
  await submit(request, 'queue-ignore', ['Leave.Me.Alone.mkv']);
  await signIn(page);

  await page.getByRole('button', { name: /Leave\.Me\.Alone\.mkv/ }).click();
  await page.getByRole('button', { name: 'Ignore', exact: true }).click();

  await expect(page.getByRole('status').filter({ hasText: 'set aside' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Leave\.Me\.Alone\.mkv/ })).toHaveCount(0);
});
