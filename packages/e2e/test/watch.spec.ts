import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { incoming } from '../support.js';
import { signIn } from './helpers.js';

test('greys out the manual check while no folder is watched', async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole('button', { name: 'Check now' })).toBeDisabled();
  await expect(page.getByText('No folder is watched.')).toBeVisible();
});

test('watches a folder of finished downloads, and checks it on demand', async ({ page }) => {
  const folder = incoming('finished');
  await mkdir(folder, { recursive: true });
  await signIn(page);

  await page.getByRole('link', { name: 'Settings' }).click();
  const section = page.locator('form', {
    has: page.getByRole('heading', { name: 'Folders to watch (source)' }),
  });
  await section.getByRole('checkbox', { name: 'Watch folders' }).check();
  await section.locator('#watch-folder-0').fill(folder);
  await section.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(section.getByText('Saved.')).toBeVisible();

  await page.getByRole('link', { name: 'Queue' }).click();
  await expect(page.getByText('Watching 1 folder(s) for finished downloads.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check now' })).toBeEnabled();

  // Just written: the settling time has not passed, which is what "Check now" is for.
  await writeFile(`${folder}/Mystery.Finished.Download.mkv`, 'video');
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect(
    page.getByText('1 release(s) submitted, 0 still being written, 0 already submitted.'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Mystery\.Finished\.Download\.mkv/ }),
  ).toBeVisible();
});

test('refuses a watched folder that is not an absolute path', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  const section = page.locator('form', {
    has: page.getByRole('heading', { name: 'Folders to watch (source)' }),
  });
  await section.getByRole('checkbox', { name: 'Watch folders' }).check();
  await section.locator('#watch-folder-0').fill('downloads');
  await section.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(section.getByRole('alert')).toHaveText(
    'Give at least one folder, as an absolute path.',
  );
});
