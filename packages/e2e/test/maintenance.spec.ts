import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { library } from '../support.js';
import { signIn } from './helpers.js';

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

// What another tool leaves behind: a `- 1080p` folder holding only its images, next to the
// folder (the name Kinoshelf writes) that holds the video.
const WORK = library('films', 'Dune (2021) {tmdb-438631}');
const LEFTOVER = library('films', 'Dune (2021) - 1080p');

test.afterEach(async () => {
  await rm(WORK, { recursive: true, force: true });
  await rm(LEFTOVER, { recursive: true, force: true });
});

test('analyses a library, takes the leftover folder out and finds the batch in the History', async ({
  page,
}) => {
  await mkdir(WORK, { recursive: true });
  await mkdir(LEFTOVER, { recursive: true });
  await writeFile(`${WORK}/Dune (2021) {tmdb-438631}.mkv`, 'video');
  await writeFile(`${LEFTOVER}/Dune (2021) - 1080p-poster.jpg`, 'image');

  await signIn(page);
  await page.getByRole('navigation').getByRole('link', { name: 'System' }).click();
  await page
    .getByRole('navigation', { name: 'Sections of the System page' })
    .getByRole('link', { name: 'Maintenance' })
    .click();
  await expect(page).toHaveURL(/tab=maintenance/);

  // Each library organized in place has its own block.
  const films = page.getByRole('article', { name: 'Films' });
  await expect(films).toBeVisible();

  await films.getByRole('button', { name: /^Analyse/ }).click();
  await expect(films.getByText('1 folder to take out').first()).toBeVisible();
  await expect(films.getByText('same work as Dune (2021) {tmdb-438631}')).toBeVisible();
  // An analysis moves nothing.
  expect(await exists(LEFTOVER)).toBe(true);

  // The confirmation says that nothing is deleted and that the History undoes it.
  await films.getByRole('button', { name: 'Tidy…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tidy Films?' });
  await expect(dialog.getByText(/Nothing is deleted/)).toBeVisible();
  await expect(dialog.getByText(/History/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(await exists(LEFTOVER)).toBe(true);

  await films.getByRole('button', { name: 'Tidy…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Tidy the library' }).click();
  await expect(films.getByText('1 folder taken out').first()).toBeVisible();
  await expect.poll(() => exists(LEFTOVER)).toBe(false);
  expect(await exists(`${WORK}/Dune (2021) {tmdb-438631}.mkv`)).toBe(true);

  // The batch is the History's, and the page found it from the link.
  await films.getByRole('link', { name: 'See the batch in the History' }).click();
  await expect(page).toHaveURL(/\/history\/./);
  await expect(page.getByText('Dune (2021) - 1080p-poster.jpg').first()).toBeVisible();
  await page.getByRole('button', { name: 'Undo this batch' }).click();
  await page.getByRole('button', { name: 'Confirm the undo' }).click();
  await expect(page.getByText('This batch was undone.')).toBeVisible();
  await expect.poll(() => exists(`${LEFTOVER}/Dune (2021) - 1080p-poster.jpg`)).toBe(true);
});

test('keeps a report across a reload', async ({ page }) => {
  await mkdir(WORK, { recursive: true });
  await mkdir(LEFTOVER, { recursive: true });
  await writeFile(`${WORK}/Dune (2021) {tmdb-438631}.mkv`, 'video');
  await writeFile(`${LEFTOVER}/Dune (2021) - 1080p-poster.jpg`, 'image');

  await signIn(page);
  await page.goto('/system?tab=maintenance');
  const films = page.getByRole('article', { name: 'Films' });
  await films.getByRole('button', { name: /^Analyse/ }).click();
  await expect(films.getByText('1 folder to take out').first()).toBeVisible();

  // The task lives in the server: a page opened again finds what it said.
  await page.reload();
  await expect(films.getByText('1 folder to take out').first()).toBeVisible();
  await expect(films.getByRole('button', { name: 'Tidy…' })).toBeVisible();
});

test('the backup card leads to the retention settings, scrolled to its section', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/system?tab=maintenance');
  await page.getByRole('link', { name: 'Change in the Settings' }).first().click();

  // An anchor must not be taken for part of the path (that was a 404).
  await expect(page).toHaveURL(/\/settings#retention$/);
  await expect(page.getByRole('heading', { name: 'Retention' })).toBeInViewport();
  await expect(page.getByLabel('Database backups to keep')).toHaveValue('3');
});

test('empties what a tidy-up set aside, after a confirmation that says it cannot be undone', async ({
  page,
}) => {
  await mkdir(WORK, { recursive: true });
  await mkdir(LEFTOVER, { recursive: true });
  await writeFile(`${WORK}/Dune (2021) {tmdb-438631}.mkv`, 'video');
  await writeFile(`${LEFTOVER}/Dune (2021) - 1080p-poster.jpg`, 'image');

  await signIn(page);
  await page.goto('/system?tab=maintenance');
  const films = page.getByRole('article', { name: 'Films' });
  await films.getByRole('button', { name: /^Analyse/ }).click();
  await films.getByRole('button', { name: 'Tidy…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Tidy the library' }).click();
  await expect(films.getByText('1 folder taken out').first()).toBeVisible();

  // Just set aside: younger than the 30 days, so only "Empty all" has something to delete.
  const card = page.getByRole('article', { name: 'Empty replaced/' });
  await expect(card.getByRole('button', { name: /^Empty \(older than 30 days\)/ })).toBeDisabled();
  await card.getByRole('button', { name: 'Empty all' }).click();

  const dialog = page.getByRole('dialog', { name: /Empty replaced/ });
  await expect(dialog.getByText(/cannot be undone|Videos are never in it/).first()).toBeVisible();
  // The box must be ticked first: this is the one action that cannot be undone.
  const confirm = dialog.getByRole('button', { name: 'Delete for good' });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('I understand this cannot be undone.').check();
  await confirm.click();

  await expect(card.getByText(/files? deleted/)).toBeVisible();
  // Nothing is left to empty.
  await expect(card.getByRole('button', { name: 'Empty all' })).toBeDisabled();
});
