import { access, mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { API_KEY, incoming, library } from '../support.js';
import { signIn, signInAt } from './helpers.js';

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );
const DUNE = library('films', 'Dune (2021) {tmdb-438631}', 'Dune (2021) {tmdb-438631}.mkv');

test('validates an arrival and finds it in the library it was sent to', async ({
  page,
  request,
}) => {
  const folder = incoming('arrivals-dune');
  await mkdir(folder, { recursive: true });
  // No year: Dune of 1984 and Dune of 2021 both fit, so a human has to choose.
  await writeFile(`${folder}/Dune.1080p.mkv`, 'video');
  const headers = { authorization: `Bearer ${API_KEY}` };
  const created = await request.post('/api/libraries', {
    headers,
    data: { name: 'Dune drop', source: folder, into: { movie: 'films', series: 'series' } },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  expect((await request.post(`/api/libraries/${id}/scan`, { headers })).status()).toBe(202);

  await signIn(page);
  await page.goto('/arrivals');
  await page.getByRole('button', { name: /Dune\.1080p\.mkv/ }).click();

  // The 2021 film, sent to the library the folder points at.
  await expect(page.getByRole('radio', { name: /Dune \(2021\)/ })).toBeChecked();
  await expect(page.getByRole('combobox', { name: 'Destination library' })).toHaveValue('films');
  await expect(page.getByText(DUNE)).toBeVisible();
  await page.getByRole('button', { name: 'Validate', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Transfer started' })).toBeVisible();
  await expect.poll(() => exists(DUNE)).toBe(true);

  // The library lists it once transferred, without a new scan.
  await page.getByRole('link', { name: 'Films' }).first().click();
  await expect(page.getByRole('button', { name: /Dune/ })).toBeVisible();
});

test('the Check now button is disabled while no folder is watched', async ({ page }) => {
  await signIn(page);
  await page.goto('/arrivals');
  await expect(page.getByRole('button', { name: 'Check now' })).toBeDisabled();
});

test('lists a remembered destination in the settings and forgets it', async ({ page, request }) => {
  const folder = incoming('arrivals-remember');
  await mkdir(folder, { recursive: true });
  await writeFile(`${folder}/Dune.480p.mkv`, 'video');
  const headers = { authorization: `Bearer ${API_KEY}` };
  const created = await request.post('/api/libraries', {
    headers,
    data: { name: 'Remember drop', source: folder, into: { movie: 'films', series: 'series' } },
  });
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/libraries/${id}/scan`, { headers });
  await expect
    .poll(async () => {
      const page = await request.get('/api/arrivals', { headers });
      const { items } = (await page.json()) as { items: { id: string; release: string }[] };
      return items.find(({ release }) => release.includes('Dune.480p'))?.id ?? null;
    })
    .not.toBeNull();
  const { items } = (await (await request.get('/api/arrivals', { headers })).json()) as {
    items: { id: string; release: string }[];
  };
  const entry = items.find(({ release }) => release.includes('Dune.480p'));
  const matched = await request.post(`/api/entries/${entry?.id ?? ''}/match`, {
    headers,
    data: {
      kind: 'movie',
      id: { provider: 'tmdb', id: 438631 },
      title: 'Dune',
      year: 2021,
      libraryId: 'films',
      rememberDestination: true,
      remember: false,
    },
  });
  expect(matched.status()).toBe(200);

  await signInAt(page, '/settings');
  const forget = page.getByRole('button', { name: /Forget the destination of/ });
  await expect(forget).toBeVisible();
  await forget.click();
  await expect(forget).toHaveCount(0);
  expect(await (await request.get('/api/work-destinations', { headers })).json()).toEqual([]);
});
