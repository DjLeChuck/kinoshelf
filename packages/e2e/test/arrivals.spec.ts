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

test('Check now submits what a watched folder holds without waiting for it to settle', async ({
  page,
  request,
}) => {
  const folder = incoming('arrivals-watched');
  await mkdir(folder, { recursive: true });
  const headers = { authorization: `Bearer ${API_KEY}` };
  const created = await request.post('/api/libraries', {
    headers,
    data: {
      name: 'Watched drop',
      source: folder,
      into: { movie: 'films', series: 'series' },
      watch: true,
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  try {
    // Written just now: the watcher would still wait for it to settle.
    await mkdir(`${folder}/Alien.1979.1080p`, { recursive: true });
    await writeFile(`${folder}/Alien.1979.1080p/Alien.1979.1080p.mkv`, 'video');

    await signInAt(page, '/arrivals');
    const check = page.getByRole('button', { name: 'Check now' });
    await expect(check).toBeEnabled();
    await check.click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Releases found: 1 submitted' }),
    ).toBeVisible();
  } finally {
    // The other tests expect no watched folder.
    await request.delete(`/api/libraries/${id}`, { headers });
  }
  await page.reload();
  await expect(page.getByRole('button', { name: 'Check now' })).toBeDisabled();
});

test('keeps the state filter in the address', async ({ page }) => {
  await signInAt(page, '/arrivals?state=review');
  const filter = (name: string) => page.getByRole('button', { name, exact: true });
  await expect(filter('To validate')).toHaveAttribute('aria-pressed', 'true');

  await filter('Not recognized').click();
  await expect(page).toHaveURL(/\/arrivals\?state=unrecognized$/);
  await page.reload();
  await expect(filter('Not recognized')).toHaveAttribute('aria-pressed', 'true');

  await filter('All').click();
  await expect(page).toHaveURL(/\/arrivals$/);
});

test('sets a series folder aside once, and shows the episode of another show set apart', async ({
  page,
  request,
}) => {
  const folder = incoming('arrivals-release');
  const pack = `${folder}/Sev.Pack.1080p`;
  await mkdir(pack, { recursive: true });
  // "Sev" is not close enough to "Severance" to be decided alone; "Zzz" finds nothing.
  for (const name of ['Sev.S01E01.mkv', 'Sev.S01E02.mkv', 'Zzz.S01E01.mkv']) {
    await writeFile(`${pack}/${name}`, 'video');
  }
  const headers = { authorization: `Bearer ${API_KEY}` };
  const created = await request.post('/api/libraries', {
    headers,
    data: { name: 'Release drop', source: folder, into: { movie: 'films', series: 'series' } },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  expect((await request.post(`/api/libraries/${id}/scan`, { headers })).status()).toBe(202);

  await signIn(page);
  await page.goto('/arrivals');

  // One line for the release, the other show listed under it and tied to it.
  await expect(page.getByRole('button', { name: /^Sev\.Pack\.1080p/ })).toBeVisible();
  const aside = page.getByRole('list', { name: /set apart from Sev\.Pack\.1080p/ });
  await expect(aside.getByText('Zzz.S01E01.mkv')).toBeVisible();
  await expect(aside.getByText('Set apart')).toBeVisible();
  await expect(aside.getByText('linked to “Sev.Pack.1080p”')).toBeVisible();

  await page.getByRole('button', { name: /^Sev\.Pack\.1080p/ }).click();
  await expect(
    page.getByText('applies to the 2 files of this series in this folder'),
  ).toBeVisible();
  // Setting the release aside takes its two files along (a transfer would fill the series
  // library that another test counts).
  await page.getByRole('button', { name: 'Ignore' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'set aside' })).toBeVisible();

  // The set-apart episode still waits for its own decision.
  await expect(page.getByRole('button', { name: /Zzz\.S01E01\.mkv/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Sev\.Pack\.1080p/ })).toHaveCount(0);
});
