import { mkdir, writeFile } from 'node:fs/promises';
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { API_KEY, AUTH_HEADERS, incoming } from '../support.js';

/**
 * A link of the main navigation. A page can hold other links of the same name (a banner's "See the
 * history" while a transfer runs): which ones are there depends on timing, so a bare
 * `getByRole('link', { name: 'History' })` is a race. Not `exact`: a badge ("System 1") is part
 * of a link's name.
 */
export const navLink = (page: Page, name: string): Locator =>
  page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name });

/** Opens `path` and signs in: the page asked for is the one shown afterwards. */
export async function signInAt(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.getByLabel('API key').fill(API_KEY);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Signs in and lands on the libraries, which most tests start from. */
export async function signIn(page: Page): Promise<void> {
  await signInAt(page, '/libraries');
  await expect(page.getByRole('heading', { name: 'Libraries' })).toBeVisible();
}

/**
 * Drops files in a folder of their own and submits it like a post-download script would. With
 * `apply`, what matches with confidence is transferred at once.
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
  // Content of its own: a file the size of one already in the library is a copy of it, which
  // Arrivals sets aside instead of transferring.
  await Promise.all(files.map((file) => writeFile(incoming(folder, file), `video of ${folder}`)));

  const created = await request.post('/api/jobs', { headers: AUTH_HEADERS, data: { path, apply } });
  expect(created.status()).toBe(202);
  const { id } = (await created.json()) as { id: string };

  await expect
    .poll(
      async () => {
        const job = (await (
          await request.get(`/api/jobs/${id}`, { headers: AUTH_HEADERS })
        ).json()) as {
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

/**
 * Resolves once the page has stopped scrolling (a smooth scroll, a key's or a click's, runs for
 * hundreds of milliseconds, longer on a loaded machine). Counted in frames, not in time: a fixed
 * sleep is too short exactly when the machine is slow. Whatever is asked of the page next, an
 * animation still running would take the scroll back.
 */
export async function scrollSettled(page: Page): Promise<void> {
  // A string: this package has no DOM types, which the page's own code does not need here.
  await page.evaluate(`new Promise((resolve) => {
    let last = window.scrollY;
    let still = 0;
    const frame = () => {
      still = window.scrollY === last ? still + 1 : 0;
      last = window.scrollY;
      if (still >= 12) {
        resolve(undefined);
      } else {
        requestAnimationFrame(frame);
      }
    };
    requestAnimationFrame(frame);
  })`);
}
