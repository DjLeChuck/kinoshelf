import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { incoming } from '../support.js';
import { signIn } from './helpers.js';

test('greys out the manual check while no folder is watched', async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole('button', { name: 'Check now' })).toBeDisabled();
  await expect(page.getByText('No folder is watched.')).toBeVisible();
});

test('watches a library of finished downloads, and checks it on demand', async ({ page }) => {
  const folder = incoming('finished');
  await mkdir(folder, { recursive: true });
  await signIn(page);

  await page.getByRole('link', { name: 'Libraries' }).click();
  await page.getByRole('link', { name: '+ Add' }).click();
  await page.locator('#lib-source').fill(folder);
  await page.getByLabel('Watch the source folder').check();
  await page.getByRole('button', { name: 'Create the library' }).click();
  await expect(page.getByRole('region', { name: 'Libraries' })).toContainText('Watched');

  // The settings only say how, and point to the libraries for which.
  await page.getByRole('link', { name: 'Settings' }).click();
  const section = page.locator('form', {
    has: page.getByRole('heading', { name: 'Folder watching' }),
  });
  await expect(
    section.getByRole('link', { name: 'Choose the watched folders in the libraries' }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Queue' }).click();
  await expect(page.getByText('Watching 1 folder for finished downloads.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check now' })).toBeEnabled();

  // Just written: the settling time has not passed, which is what "Check now" is for.
  await writeFile(`${folder}/Mystery.Finished.Download.mkv`, 'video');
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect(
    page.getByText('1 release submitted, 0 still being written, 0 already submitted.'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Mystery\.Finished\.Download\.mkv/ }),
  ).toBeVisible();
});
