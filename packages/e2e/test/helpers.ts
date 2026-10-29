import { mkdir, writeFile } from 'node:fs/promises';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { API_KEY, incoming } from '../support.js';

const auth = { authorization: `Bearer ${API_KEY}` };

export async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('API key').fill(API_KEY);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Validation queue' })).toBeVisible();
}

/**
 * Drops files in a folder of their own and submits it like a post-download script would. With
 * `apply`, what matches with confidence is transferred at once and the rest waits in the queue.
 * Resolves when the analysis is over.
 */
export async function submit(
  request: APIRequestContext,
  folder: string,
  files: readonly string[],
  apply = false,
): Promise<string> {
  const path = incoming(folder);
  await mkdir(path, { recursive: true });
  await Promise.all(files.map((file) => writeFile(incoming(folder, file), 'video')));

  const created = await request.post('/api/jobs', { headers: auth, data: { path, apply } });
  expect(created.status()).toBe(202);
  const { id } = (await created.json()) as { id: string };

  await expect
    .poll(
      async () => {
        const job = (await (await request.get(`/api/jobs/${id}`, { headers: auth })).json()) as {
          status: string;
          execution: { status: string } | null;
        };
        // An `apply` job is over when its transfer is.
        return job.status === 'done' && (!apply || job.execution?.status === 'done');
      },
      { message: `job ${id} did not finish` },
    )
    .toBe(true);
  return id;
}
