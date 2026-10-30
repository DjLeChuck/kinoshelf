import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { incoming } from '../support.js';
import { signInAt, submit } from './helpers.js';

// The first test runs on an install that has done nothing yet, and the second one on what it
// leaves behind: the order matters, and so does being the first file of the run.
test.describe.configure({ mode: 'serial' });

test('welcomes a new install, remembers a skipped step and ends on a failed first folder', async ({
  page,
}) => {
  await signInAt(page, '/');
  await expect(page.getByRole('heading', { name: /put your movies and series/ })).toBeVisible();

  // Only what the setup needs is in the nav until it is left.
  await expect(page.getByRole('link', { name: 'Queue' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();

  // The key and the destination come from the environment and the config: already done.
  const progress = page.getByRole('progressbar', { name: 'Steps completed' });
  await expect(progress).toHaveAttribute('aria-valuenow', '2');

  // The next step asks for what it needs on the spot, without a trip to the settings.
  await page.getByLabel('Address').fill('http://plex.invalid:32400');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(progress).toHaveAttribute('aria-valuenow', '3');

  // Stored by the server, not by the browser.
  await page.reload();
  await expect(progress).toHaveAttribute('aria-valuenow', '3');
  await expect(page.getByRole('heading', { name: /put your movies and series/ })).toBeVisible();

  // The last step sends a folder that is not there: the job fails before any search. The setup
  // ends all the same, and the home page it leads to says what happened.
  const missing = incoming('never-created');
  await page.getByLabel('Folder to analyse').fill(missing);
  await page.getByRole('button', { name: 'Analyse', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Hello' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Queue' })).toBeVisible();
  const failed = page.getByRole('alert').filter({ hasText: 'Analysis failed' });
  await expect(failed).toContainText(missing);
  await expect(failed).toContainText('Path not found');
});

test('keeps a failed analysis on the home page until the folder is sent again', async ({
  page,
}) => {
  await signInAt(page, '/');
  const failed = page.getByRole('alert').filter({ hasText: 'Analysis failed' });
  await expect(failed).toContainText('never-created');

  // Nothing changed: it fails again, and the path is still listed once.
  await page.getByRole('button', { name: 'Send this folder again' }).click();
  await expect(failed).toHaveCount(1);
  await expect(failed).toContainText('Path not found');

  // The cause is gone (the folder is there now): sending it again clears the failure.
  const folder = incoming('never-created');
  await mkdir(folder, { recursive: true });
  await writeFile(`${folder}/Mystery.Retried.Footage.mkv`, 'video');
  await page.getByRole('button', { name: 'Send this folder again' }).click();
  await expect(failed).toHaveCount(0);
  await expect(page.getByText('Mystery.Retried.Footage.mkv').first()).toBeVisible();
});

test('shows what waits for a decision on the home page', async ({ page, request }) => {
  await submit(request, 'home-waiting', ['Mystery.Home.Footage.mkv']);
  await signInAt(page, '/');

  await expect(
    page.getByRole('heading', { name: /files? waiting for your validation/ }),
  ).toBeVisible();
  await expect(page.getByText('Mystery.Home.Footage.mkv')).toBeVisible();

  await page.getByRole('link', { name: 'Open the validation queue' }).click();
  await expect(page.getByRole('heading', { name: 'Validation queue' })).toBeVisible();
});
