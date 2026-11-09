import { expect, test } from '@playwright/test';
import { signIn } from './helpers.js';

test('signs in with Plex, picks the server, and stays signed in after a reload', async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  const form = () =>
    page.locator('form', { has: page.getByRole('heading', { name: 'Plex server' }) });
  await form().getByLabel('Tell Plex about each transfer').check();

  // plex.tv opens in a tab of its own; the page keeps asking until the PIN is claimed.
  const approval = page.waitForEvent('popup');
  await form().getByRole('button', { name: 'Sign in with Plex' }).click();
  await expect((await approval).getByRole('heading', { name: 'Kinoshelf approved' })).toBeVisible();

  await expect(form().getByText('Signed in with Plex. The access renews itself.')).toBeVisible();
  // Typing a token is not offered once signed in: the sign-in replaces it.
  await expect(form().getByLabel('Or paste a token')).toHaveCount(0);

  // One line per server, not per address; picking it takes the best address (the local one).
  const servers = form().getByLabel('Server of this account');
  await expect(servers.locator('option')).toHaveText(['Choose a server…', 'Living room']);
  await servers.selectOption('Living room');
  await expect(form().getByLabel('Address', { exact: true })).toHaveValue(
    'http://192.168.1.10:32400',
  );

  // The others stay one menu away, readable, with the relay last.
  const addresses = form().getByLabel('Address of this server');
  await expect(addresses.locator('option')).toHaveText([
    '192.168.1.10:32400 · local network',
    '192.168.1.10:32400 · local network, encrypted',
    'relay.plex.example:8443 · relay',
  ]);
  await form().getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form().getByText('Saved.')).toBeVisible();

  await page.reload();
  await expect(form().getByText('Signed in with Plex. The access renews itself.')).toBeVisible();
  await expect(form().getByLabel('Address', { exact: true })).toHaveValue(
    'http://192.168.1.10:32400',
  );

  // Signing out brings back the token field, and the page leaves nothing behind for the others.
  await form().getByRole('button', { name: 'Sign out' }).click();
  await expect(form().getByRole('button', { name: 'Sign in with Plex' })).toBeVisible();
  await expect(form().getByLabel('Or paste a token')).toBeVisible();
  await form().getByLabel('Tell Plex about each transfer').uncheck();
  await form().getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form().getByText('Saved.')).toBeVisible();
});
