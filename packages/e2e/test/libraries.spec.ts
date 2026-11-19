import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { incoming } from '../support.js';
import { navLink, signIn } from './helpers.js';

test('adds an arrival folder in the settings, edits it, then deletes it', async ({ page }) => {
  const folder = incoming('finished');
  await mkdir(folder, { recursive: true });
  await signIn(page);
  await navLink(page, 'Settings').click();

  const section = page.locator('section', {
    has: page.getByRole('heading', { name: 'Folders', exact: true }),
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

test('an arrival folder can send to one kind only', async ({ page }) => {
  const folder = incoming('films-only');
  await mkdir(folder, { recursive: true });
  await signIn(page);
  await navLink(page, 'Settings').click();

  const section = page.locator('section', {
    has: page.getByRole('heading', { name: 'Folders', exact: true }),
  });
  await section.getByRole('button', { name: '+ Add' }).nth(1).click();
  await section.getByRole('textbox', { name: 'Source folder' }).fill(folder);
  await section.getByLabel('Series go to').selectOption({ label: 'None' });
  await section.getByRole('button', { name: 'Create the library' }).click();

  const row = section.getByRole('button', { name: /^films-only/ });
  await expect(row).toContainText('Movies → Films');
  await expect(row).not.toContainText('Series →');

  // Naming no kind at all is refused: files would have nowhere to go.
  await row.click();
  await section.getByLabel('Movies go to').selectOption({ label: 'None' });
  await section.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(section.getByRole('alert')).toContainText('Choose a destination library');
  await section.getByLabel('Movies go to').selectOption({ label: 'Films' });

  await section.getByRole('button', { name: 'Delete', exact: true }).click();
  await section.getByRole('button', { name: 'Yes, delete' }).click();
  await expect(section.getByRole('button', { name: /^films-only/ })).toHaveCount(0);
});
