import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { AUTH_HEADERS, incoming } from '../support.js';
import { signInAt } from './helpers.js';

test('cancels a running scan: the library is untouched and the History says cancelled', async ({
  page,
  request,
}) => {
  // A library of its own, holding one title the fake TMDB answers slowly (see `stack.mjs`).
  const source = incoming('slow-scan');
  await mkdir(source, { recursive: true });
  await writeFile(incoming('slow-scan', 'Slowscan.2020.mkv'), 'video');
  const created = await request.post('/api/libraries', {
    headers: AUTH_HEADERS,
    data: { name: 'Slow', source, type: 'movie' },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };

  await signInAt(page, `/libraries/${id}`);
  const scan = page.getByRole('button', { name: 'Update from source' });
  await scan.click();

  // The button of the page is busy while it runs, and offers to stop it.
  const cancel = page.getByRole('button', { name: 'Cancel the scan' });
  await expect(cancel).toBeVisible();
  await cancel.click();

  // It stops at its next check (the slow answer), and the page is back to where it started: no
  // failure banner, and a scan can be asked again.
  await expect(cancel).toHaveCount(0, { timeout: 20_000 });
  await expect(scan).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);

  const libraries = (await (
    await request.get('/api/libraries', { headers: AUTH_HEADERS })
  ).json()) as { id: string; lastScan: { status: string } | null }[];
  const last = libraries.find((library) => library.id === id);
  expect(last?.lastScan?.status).toBe('cancelled');

  // The History lists it as cancelled, not failed.
  await page.getByRole('navigation').getByRole('link', { name: 'History' }).click();
  await page.getByLabel('Show every analysis').check();
  await expect(page.getByText('Cancelled').first()).toBeVisible();
});
