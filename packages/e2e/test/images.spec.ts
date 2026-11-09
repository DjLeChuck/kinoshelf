import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { AUTH_HEADERS, library, TMDB_PORT } from '../support.js';
import { signIn } from './helpers.js';

const FOLDER = library('films', 'Dune (1984) {tmdb-841}');
// A JPEG header and a mark: what the poster is before the user changes it.
const OLD_POSTER = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('old')]);

test.describe('the images of a movie', () => {
  test.beforeEach(async ({ request }) => {
    await rm(FOLDER, { recursive: true, force: true });
    await mkdir(FOLDER, { recursive: true });
    await writeFile(`${FOLDER}/Dune (1984) {tmdb-841}.mkv`, 'video');
    await writeFile(`${FOLDER}/poster.jpg`, OLD_POSTER);
    expect(
      (
        await request.patch('/api/libraries/films', {
          headers: AUTH_HEADERS,
          data: { metadata: 'nfo' },
        })
      ).status(),
    ).toBe(200);
    // The page must read this folder, not what an earlier spec left there: wait for the scan.
    const scan = await request.post('/api/libraries/films/scan', { headers: AUTH_HEADERS });
    expect(scan.status()).toBe(202);
    const { id } = (await scan.json()) as { id: string };
    await expect
      .poll(
        async () =>
          (
            (await (await request.get(`/api/jobs/${id}`, { headers: AUTH_HEADERS })).json()) as {
              status: string;
            }
          ).status,
      )
      .toBe('done');
  });

  test.afterEach(async ({ request }) => {
    await request.patch('/api/libraries/films', {
      headers: AUTH_HEADERS,
      data: { metadata: null },
    });
    await rm(FOLDER, { recursive: true, force: true });
  });

  async function openPanel(page: Page): Promise<void> {
    await signIn(page);
    await page.goto('/libraries/films');
    await page.getByRole('row').filter({ hasText: '1984' }).locator('button.link').click();
    await expect(page.getByRole('button', { name: 'Change the poster' })).toBeVisible();
  }

  test('changes the poster and adds a logo in one go, then closes on Escape', async ({ page }) => {
    await openPanel(page);
    // No logo yet: a dashed box invites to add one, next to the two other triggers.
    await expect(page.getByRole('button', { name: 'Change the background' })).toBeVisible();
    await page.getByRole('button', { name: 'Add a logo' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: /Images — Dune \(1984\)/ })).toBeVisible();
    // The logo's tab is the one asked for, with what TMDB offers counted on each.
    await expect(dialog.getByRole('tab', { name: /Logo/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(dialog.getByRole('tab', { name: /Poster/ })).toContainText('2');
    await expect(dialog.getByRole('button', { name: 'Apply' })).toBeDisabled();

    // The library's language is English here: its images come first.
    const logos = dialog.getByRole('list', { name: 'TMDB images' }).getByRole('button');
    await expect(logos).toHaveCount(2);
    await logos.first().click();
    await expect(logos.first()).toHaveAttribute('aria-pressed', 'true');

    // A choice is kept on its tab while another one is looked at.
    await dialog.getByRole('tab', { name: /Poster/ }).click();
    await dialog.getByRole('list', { name: 'TMDB images' }).getByRole('button').nth(1).click();
    await expect(dialog.getByText('2 changes pending: poster.jpg, logo.png')).toBeVisible();

    // Clicking a chosen image again takes the choice back.
    await dialog.getByRole('list', { name: 'TMDB images' }).getByRole('button').nth(1).click();
    await expect(dialog.getByText('1 change pending: logo.png')).toBeVisible();
    await dialog.getByRole('list', { name: 'TMDB images' }).getByRole('button').first().click();

    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(/Images updated/)).toBeVisible();

    // Both files are on the disk, the poster no longer the old one.
    const logo = await readFile(`${FOLDER}/logo.png`);
    expect(logo.subarray(1, 4).toString()).toBe('PNG');
    expect((await readFile(`${FOLDER}/poster.jpg`)).equals(OLD_POSTER)).toBe(false);

    // The logo now sits on the panel, as a trigger of its own.
    await expect(page.getByRole('button', { name: 'Change the logo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add a logo' })).toHaveCount(0);

    // Reopened, the dialog closes with Escape and gives the focus back to its trigger.
    const trigger = page.getByRole('button', { name: 'Change the poster' });
    await trigger.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('refuses an address on the local network and writes nothing', async ({ page }) => {
    await openPanel(page);
    await page.getByRole('button', { name: 'Change the poster' }).click();
    const dialog = page.getByRole('dialog');
    // The format is said by the file written: a JPEG here.
    await expect(
      dialog.getByText(/must be a JPEG, like the file written \(poster\.jpg\)/),
    ).toBeVisible();

    await dialog.getByLabel('Custom image (address)').fill('not an address');
    await dialog.getByRole('button', { name: 'Load the preview' }).click();
    await expect(dialog.getByRole('alert')).toContainText('http://');

    // The fake TMDB runs on this machine: an address the settings do not allow by default.
    await dialog
      .getByLabel('Custom image (address)')
      .fill(`http://127.0.0.1:${String(TMDB_PORT)}/t/p/original/mine.jpg`);
    await dialog.getByRole('button', { name: 'Load the preview' }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect((await readFile(`${FOLDER}/poster.jpg`)).equals(OLD_POSTER)).toBe(true);
  });
});
