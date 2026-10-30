import { access, mkdir, readdir, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { incoming, library } from '../support.js';
import { signIn } from './helpers.js';

const source = incoming('lib-films');
const destination = library('sorted-out');

async function openNew(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Libraries' }).click();
  await page.getByRole('link', { name: '+ Add' }).click();
  await expect(page.getByRole('heading', { name: 'New library' })).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test('refuses a relative source and a folder that is not there', async ({ page }) => {
  await signIn(page);
  await openNew(page);

  await page.locator('#lib-source').fill('films');
  await page.getByRole('button', { name: 'Create the library' }).click();
  await expect(page.getByRole('alert')).toHaveText('Give the source folder, as an absolute path.');

  await page.locator('#lib-source').fill(incoming('lib-nowhere'));
  await page.getByRole('button', { name: 'Create the library' }).click();
  await expect(page.getByRole('alert')).toContainText('No folder at');
});

test('shows the library in the list while it is being filled in', async ({ page }) => {
  await signIn(page);
  await openNew(page);

  const draft = page.locator('.item.draft');
  await expect(draft).toContainText('New library');
  await expect(draft).toContainText('not saved yet');

  await page.locator('#lib-source').fill('/mnt/some/Films 4K');
  await expect(draft).toContainText('Films 4K');
  await expect(draft).toContainText('/mnt/some/Films 4K');
  await expect(draft).toContainText('Manual');

  await page.getByRole('radio', { name: /^Hardlink/ }).check({ force: true });
  await expect(draft).toContainText('Hardlink');
  await page.getByLabel('Name', { exact: true }).fill('Mine');
  await expect(draft).toContainText('Mine');
});

test('creates a library, changes it, and warns about the hardlink mode', async ({ page }) => {
  await mkdir(source, { recursive: true });
  await mkdir(destination, { recursive: true });
  await Promise.all(
    ['Alien.1979.1080p.mkv', 'Dune.1984.1080p.mkv', 'zzqx.unknown.file.mkv'].map((file) =>
      writeFile(`${source}/${file}`, 'video'),
    ),
  );

  await signIn(page);
  await openNew(page);
  await page.getByLabel('Name', { exact: true }).fill('Films');
  await page.locator('#lib-source').fill(source);
  await page.locator('#lib-dest-single').fill(destination);
  await page.getByRole('radio', { name: /^Plex/ }).first().check();

  await page.getByRole('radio', { name: /Hardlink/ }).check();
  await expect(
    page.getByText('Source and destination must be on the same file system'),
  ).toBeVisible();
  await page.getByRole('radio', { name: /^Copy/ }).check();
  await expect(
    page.getByText('Source and destination must be on the same file system'),
  ).toHaveCount(0);

  await page.getByRole('button', { name: 'Create the library' }).click();
  await expect(page).toHaveURL(/\/libraries\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Films' })).toBeVisible();
  const list = page.getByRole('region', { name: 'Libraries' });
  await expect(list.getByRole('link', { name: /Films/ })).toContainText('Manual');

  // A change shows in the list.
  await page.getByLabel('Name', { exact: true }).fill('Films to sort');
  await page.getByLabel('Watch the source folder').check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await expect(list.getByRole('link', { name: /Films to sort/ })).toContainText('Watched');

  // Not watched: the other tests count on nothing being picked up behind their back.
  await page.getByLabel('Watch the source folder').uncheck();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(list.getByRole('link', { name: /Films to sort/ })).toContainText('Manual');
});

test('scans a library, picks files, simulates and runs the batch', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Libraries' }).click();
  await page
    .getByRole('region', { name: 'Libraries' })
    .getByRole('link', { name: /Films to sort/ })
    .click();
  await page.getByRole('button', { name: 'Start a scan' }).click();

  await expect(page).toHaveURL(/\/libraries\/[^/]+\/scan\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: 'Scan result' })).toBeVisible();
  const rename = page.getByRole('tab', { name: /To rename/ });
  await expect(rename).toContainText('2');
  await expect(page.getByRole('tab', { name: /Not recognised/ })).toContainText('1');

  // Everything is selected at first; take one file out.
  await expect(page.getByText('2 files selected')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Select Dune.1984.1080p.mkv' }).uncheck();
  await expect(page.getByText('1 file selected')).toBeVisible();

  // The simulation writes nothing.
  await page.getByRole('button', { name: 'Simulate (dry run)' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Dry run: 1 file would be processed' }),
  ).toBeVisible();
  expect(await readdir(destination)).toEqual([]);

  // Select all, then none, with the header box.
  const all = page.getByRole('checkbox', { name: 'Select all' });
  await all.check();
  await all.uncheck();
  await expect(page.getByRole('button', { name: 'Run the batch' })).toBeDisabled();
  await all.check();
  await page.getByRole('checkbox', { name: 'Select Dune.1984.1080p.mkv' }).uncheck();

  await page.getByRole('button', { name: 'Run the batch' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Batch queued for 1 file' }),
  ).toBeVisible();
  await expect
    .poll(async () => (await readdir(destination)).some((name) => name.startsWith('Alien')))
    .toBe(true);
  await expect(access(`${source}/Dune.1984.1080p.mkv`)).resolves.toBeUndefined();

  // Nothing to select outside "to rename".
  await page.getByRole('tab', { name: /Not recognised/ }).click();
  await expect(page.getByText('zzqx.unknown.file.mkv')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Select zzqx/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Run the batch' })).toBeDisabled();

  // The job page leads back to the result.
  const jobId = /scan\/([0-9a-f-]+)$/.exec(page.url())?.[1] ?? '';
  await page.goto(`/jobs/${jobId}`);
  await page.getByRole('link', { name: 'Scan result' }).click();
  await expect(page.getByRole('heading', { name: 'Scan result' })).toBeVisible();
});

test('deletes a library after a confirmation, and keeps its files', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Libraries' }).click();
  const list = page.getByRole('region', { name: 'Libraries' });
  await list.getByRole('link', { name: /Films to sort/ }).click();

  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Films to sort');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(list.getByRole('link', { name: /Films to sort/ })).toBeVisible();

  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, delete' }).click();
  await expect(list.getByRole('link', { name: /Films to sort/ })).toHaveCount(0);
  await expect(access(`${source}/Dune.1984.1080p.mkv`)).resolves.toBeUndefined();
});

test('shows the NFO and images a library of the jellyfin profile writes', async ({ page }) => {
  const folder = incoming('lib-jellyfin');
  const target = library('jellyfin-out');
  await mkdir(folder, { recursive: true });
  await mkdir(target, { recursive: true });
  await writeFile(`${folder}/Alien.1979.1080p.mkv`, 'video');

  await signIn(page);
  await openNew(page);
  await page.getByLabel('Name', { exact: true }).fill('Jellyfin films');
  await page.locator('#lib-source').fill(folder);
  await page.locator('#lib-dest-single').fill(target);
  await page
    .getByRole('radio', { name: /^Jellyfin/ })
    .first()
    .check();
  await page.getByRole('button', { name: 'Create the library' }).click();
  await expect(page).toHaveURL(/\/libraries\/[^/]+$/);

  await page.getByRole('button', { name: 'Start a scan' }).click();
  await expect(page.getByRole('heading', { name: 'Scan result' })).toBeVisible();
  await expect(page.getByText('Also writes: movie.nfo, poster.jpg, fanart.jpg')).toBeVisible();

  await page.getByRole('button', { name: 'Simulate (dry run)' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: '1 NFO and 2 images would be written' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Run the batch' }).click();
  await expect
    .poll(async () =>
      (await readdir(`${target}/Alien (1979) [tmdbid-348]`).catch(() => [] as string[])).sort(),
    )
    .toEqual(expect.arrayContaining(['Alien (1979) [tmdbid-348].mkv', 'movie.nfo']));

  // The batch lists what was written, apart from the video. The images come from the real TMDB
  // host, out of reach here: only the NFO is generated locally.
  await page.getByRole('link', { name: 'History' }).click();
  await page.getByRole('button').filter({ hasText: 'lib-jellyfin' }).first().click();
  await expect(page.getByRole('heading', { name: 'Metadata written' })).toBeVisible();
  await expect(page.getByText('movie.nfo', { exact: true })).toBeVisible();
  await expect(page.getByText('NFO generated')).toBeVisible();
});
