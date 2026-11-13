import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { incoming } from '../support.js';
import { signInAt } from './helpers.js';

// It runs on an install that has done nothing yet: being the first file of the run matters.
test('welcomes a new install, remembers a skipped step and ends on the libraries', async ({
  page,
}) => {
  await signInAt(page, '/');
  await expect(page.getByRole('heading', { name: /put your movies and series/ })).toBeVisible();

  // Only what the setup needs is in the nav until it is left.
  await expect(page.getByRole('link', { name: 'History' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();

  // The key and the libraries come from the environment and the config: already done.
  const progress = page.getByRole('progressbar', { name: 'Steps completed' });
  await expect(progress).toHaveAttribute('aria-valuenow', '2');

  // The next step asks for what it needs on the spot, without a trip to the settings.
  // Signing in with Plex is offered here as in the settings, and replaces the token.
  const approval = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Sign in with Plex' }).click();
  await expect((await approval).getByRole('heading', { name: 'Kinoshelf approved' })).toBeVisible();
  await expect(page.getByText('Signed in with Plex. The access renews itself.')).toBeVisible();
  await expect(page.getByLabel('Or paste a token')).toHaveCount(0);
  await page.getByLabel('Server of this account').selectOption('Living room');
  await expect(page.getByLabel('Address', { exact: true })).toHaveValue(
    'http://192.168.1.10:32400',
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(progress).toHaveAttribute('aria-valuenow', '3');

  // Stored by the server, not by the browser.
  await page.reload();
  await expect(progress).toHaveAttribute('aria-valuenow', '3');
  await expect(page.getByRole('heading', { name: /put your movies and series/ })).toBeVisible();

  // A step already settled can be changed: its form starts from what is saved.
  const server = page.getByRole('listitem').filter({ hasText: 'Connect Plex or Jellyfin' });
  await server.getByRole('button', { name: 'Edit' }).click();
  await expect(server.getByText('Signed in with Plex. The access renews itself.')).toBeVisible();
  await expect(server.getByLabel('Address', { exact: true })).toHaveValue(
    'http://192.168.1.10:32400',
  );
  // Signed out, the token field is back, and the account is left as the settings' test expects it.
  await server.getByRole('button', { name: 'Sign out' }).click();
  await expect(server.getByLabel('Or paste a token')).toBeVisible();
  await server.getByLabel('Address', { exact: true }).fill('http://plex.invalid:32401');
  await server.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(server.getByLabel('Address', { exact: true })).toHaveCount(0);
  await server.getByRole('button', { name: 'Edit' }).click();
  await expect(server.getByLabel('Address', { exact: true })).toHaveValue(
    'http://plex.invalid:32401',
  );
  await server.getByRole('button', { name: 'Cancel' }).click();
  await expect(progress).toHaveAttribute('aria-valuenow', '3');

  // The last step makes an arrival folder of it: one that is not there is refused on the spot.
  const missing = incoming('never-created');
  await page.getByLabel('Downloads folder').fill(missing);
  await page.getByRole('button', { name: 'Analyse', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('No folder at');
  await expect(progress).toHaveAttribute('aria-valuenow', '3');

  // With the folder there, it is created, scanned once, and the setup ends on the libraries.
  const first = incoming('first-library');
  await mkdir(first, { recursive: true });
  await writeFile(`${first}/Alien.1979.1080p.mkv`, 'video');
  await page.getByLabel('Downloads folder').fill(first);
  await page.getByLabel('Folder name').fill('First library');
  await page.getByRole('button', { name: 'Analyse', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Libraries' })).toBeVisible();
  await expect(page).toHaveURL(/\/libraries/);
  await expect(page.getByRole('link', { name: 'History' })).toBeVisible();
});
