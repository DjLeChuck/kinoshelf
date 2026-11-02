import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { incoming } from '../support.js';
import { signIn } from './helpers.js';

test('adds an arrival folder in the settings, edits it, then deletes it', async ({ page }) => {
  const folder = incoming('finished');
  await mkdir(folder, { recursive: true });
  await signIn(page);
  await page.getByRole('link', { name: 'Settings' }).click();

  const section = page.locator('section', {
    has: page.getByRole('heading', { name: 'Libraries', exact: true }),
  });
  // The two libraries of the stack are organized in place.
  await expect(section.getByRole('button', { name: /^Films/ })).toBeVisible();
  await expect(section.getByRole('button', { name: /^Series/ })).toBeVisible();

  // An arrival folder names where its movies and its series go, among the libraries of each type.
  await section.getByRole('button', { name: '+ Add' }).nth(1).click();
  await section.getByRole('textbox', { name: 'Source folder' }).fill(folder);
  await expect(section.getByLabel('Movies go to')).toHaveValue('films');
  await expect(section.getByLabel('Series go to')).toHaveValue('series');
  await section.getByLabel('Watch the source folder').check();
  await section.getByRole('button', { name: 'Create the library' }).click();

  const row = section.getByRole('button', { name: /^finished/ });
  await expect(row).toContainText('Watched');
  await expect(row).toContainText('Movies → Films · Series → Series');

  await row.click();
  await section.getByLabel('Name', { exact: true }).fill('Downloads');
  await section.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(section.getByRole('button', { name: /^Downloads/ })).toBeVisible();

  // The folder goes; the libraries it pointed at stay.
  await section.getByRole('button', { name: 'Delete', exact: true }).click();
  await section.getByRole('button', { name: 'Yes, delete' }).click();
  await expect(section.getByRole('button', { name: /^Downloads/ })).toHaveCount(0);
});
