import { expect, test, type APIRequestContext } from '@playwright/test';
import { API_KEY, incoming } from '../support.js';
import { signIn, submit } from './helpers.js';

test('opens a job from the history, filters its files and follows them to the batch', async ({
  page,
  request,
}) => {
  await submit(request, 'job-detail', ['Alien.1979.1080p.mkv', 'zzqx.unknown.file.mkv'], true);

  await signIn(page);
  await page.getByRole('link', { name: 'History' }).click();
  await page
    .getByRole('link', { name: /^From job / })
    .first()
    .click();

  await expect(page.getByRole('heading', { name: incoming('job-detail') })).toBeVisible();
  await expect(page.getByText('Settings used')).toBeVisible();

  // One tile per classification; picking one narrows the list to it.
  const files = page.getByRole('region', { name: /^Files ·/ });
  await expect(files.getByText('Alien.1979.1080p.mkv')).toBeVisible();
  await page.getByRole('button', { name: /Not recognised/ }).click();
  await expect(files.getByText('zzqx.unknown.file.mkv')).toBeVisible();
  await expect(files.getByText('Alien.1979.1080p.mkv')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show all' }).click();

  await page.getByRole('link', { name: 'Batch of the transfer' }).click();
  await expect(page).toHaveURL(/\/history\/[0-9a-f-]+$/);
  await expect(page.getByText('Alien.1979.1080p.mkv').first()).toBeVisible();
});

test('explains a failed analysis on its own page and sends the folder again', async ({
  page,
  request,
}) => {
  const missing = incoming('job-never-created');
  const created = await request.post('/api/jobs', {
    headers: { authorization: `Bearer ${API_KEY}` },
    data: { path: missing },
  });
  expect(created.status()).toBe(202);

  await signIn(page);
  await page.getByRole('link', { name: 'Home' }).click();
  const card = page.getByRole('alert').filter({ hasText: missing });
  await card.getByRole('link', { name: 'See the job' }).click();

  await expect(page.getByRole('alert').filter({ hasText: 'Path not found' })).toBeVisible();
  await page.getByRole('button', { name: 'Show the technical detail' }).click();
  await expect(page.getByText('"code": "discover.not-found"')).toBeVisible();

  await page.getByRole('button', { name: 'Send this folder again' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'created' })).toBeVisible();
});

test('transfers the files of an analysis-only job from its page', async ({ page, request }) => {
  await submit(request, 'job-transfer', ['Dune.1984.1080p.mkv']);

  await signIn(page);
  await page.getByRole('link', { name: 'History' }).click();
  await page.goto('/jobs/' + (await latestJobId(request)));
  await page.getByRole('button', { name: /^Transfer 1 file$/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Transfer queued' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Transfer / })).toHaveCount(0);
});

async function latestJobId(request: APIRequestContext): Promise<string> {
  const jobs = await request.get('/api/jobs?limit=1', {
    headers: { authorization: `Bearer ${API_KEY}` },
  });
  return ((await jobs.json()) as { id: string }[])[0]?.id ?? '';
}
