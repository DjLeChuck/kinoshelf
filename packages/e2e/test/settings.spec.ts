import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { library } from '../support.js';
import { signIn } from './helpers.js';

const SECRET = 'very-secret-token-4242';

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
});

test('saves the processing settings and finds them after a reload', async ({ page }) => {
  const section = page.locator('form', {
    has: page.getByRole('heading', { name: 'Default settings' }),
  });
  await section.getByLabel('Automatic threshold (0–100)').fill('90');
  await section.getByRole('radio', { name: /^Hardlink/ }).check({ force: true });
  await section.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(section.getByText('Saved.')).toBeVisible();

  await page.reload();
  const again = page.locator('form', {
    has: page.getByRole('heading', { name: 'Default settings' }),
  });
  await expect(again.getByLabel('Automatic threshold (0–100)')).toHaveValue('90');
  await expect(again.getByRole('radio', { name: /^Hardlink/ })).toBeChecked();
});

test('refuses a threshold out of range before asking the server', async ({ page }) => {
  const section = page.locator('form', {
    has: page.getByRole('heading', { name: 'Default settings' }),
  });
  await section.getByLabel('Automatic threshold (0–100)').fill('150');
  await section.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(section.getByRole('alert')).toContainText('a number from 0 to 100');
});

test('chooses the naming and whether NFO files are written, and finds both after a reload', async ({
  page,
}) => {
  const form = () =>
    page.locator('form', { has: page.getByRole('heading', { name: 'Default settings' }) });
  const section = form();

  // Each naming shows the paths it writes, and the id is on by default.
  await expect(section.getByRole('radio', { name: /^With the TMDB id/ })).toBeChecked();
  await expect(section.getByRole('radio', { name: /^None/ })).toBeChecked();
  await expect(section).toContainText('Dune (2021) {tmdb-438631}/Dune (2021) {tmdb-438631}.mkv');
  await expect(section).toContainText('Dune (2021)/Dune (2021).mkv');
  // Each choice of metadata says what it does, the consequence for Plex included, as it is chosen.
  await expect(section).toContainText('Only the videos are renamed.');
  await expect(section).not.toContainText('Plex only does with the optional “Plex NFO” agent');

  await section.getByRole('radio', { name: /^Without the id/ }).check({ force: true });
  await section.getByRole('radio', { name: /^NFO files and images/ }).check({ force: true });
  await expect(section).toContainText('Plex only does with the optional “Plex NFO” agent');
  await section.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(section.getByText('Saved.')).toBeVisible();

  await page.reload();
  await expect(form().getByRole('radio', { name: /^Without the id/ })).toBeChecked();
  await expect(form().getByRole('radio', { name: /^NFO files and images/ })).toBeChecked();

  // Back to the defaults, so the other specs start from them.
  await form()
    .getByRole('radio', { name: /^With the TMDB id/ })
    .check({ force: true });
  await form().getByRole('radio', { name: /^None/ }).check({ force: true });
  await form().getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form().getByText('Saved.')).toBeVisible();
});

test('picks the source folder of a library on the server’s disk instead of typing it', async ({
  page,
}) => {
  await mkdir(library('Documentaries'), { recursive: true });
  const section = page.locator('section', {
    has: page.getByRole('heading', { name: 'Libraries', exact: true }),
  });

  await section.getByRole('button', { name: '+ Add' }).first().click();
  // The picker opens where the typed value is.
  await section.getByRole('textbox', { name: 'Source folder' }).fill(library());
  await section.getByRole('button', { name: 'Browse…' }).click();
  const browser = page.getByRole('dialog', { name: 'Folders of the server' });
  await expect(browser.getByText(library(), { exact: true })).toBeVisible();

  await browser.getByRole('button', { name: 'Documentaries' }).click();
  await expect(browser.getByText(library('Documentaries'), { exact: true })).toBeVisible();
  await browser.getByRole('button', { name: 'Use this folder' }).click();

  await expect(page.getByRole('dialog', { name: 'Folders of the server' })).toHaveCount(0);
  await expect(section.getByRole('textbox', { name: 'Source folder' })).toHaveValue(
    library('Documentaries'),
  );
});

test('picks the Kinoshelf side of a path mapping, and types the server’s side', async ({
  page,
}) => {
  await mkdir(library('Cartoons'), { recursive: true });
  const section = page.locator('form', {
    has: page.getByRole('heading', { name: 'Plex server' }),
  });
  await section.getByLabel('Tell Plex about each transfer').check();
  await section.getByRole('button', { name: 'Add a mapping' }).click();

  // The picker opens where the typed value is.
  await section.getByLabel('Path in Kinoshelf').fill(library());
  await section.getByRole('button', { name: 'Browse…' }).click();

  // A modal over the page, not squeezed into the column of the field it belongs to.
  const browser = page.getByRole('dialog', { name: 'Folders of the server' });
  await expect(browser).toBeVisible();

  await browser.getByRole('button', { name: 'Cartoons' }).click();
  await browser.getByRole('button', { name: 'Use this folder' }).click();
  await expect(browser).toHaveCount(0);

  await expect(section.getByLabel('Path in Kinoshelf')).toHaveValue(library('Cartoons'));
  await expect(section.getByLabel('Path on the server')).toHaveValue('');
});

test('adds a webhook whose address is never shown back', async ({ page }) => {
  const section = page.locator('form', { has: page.getByRole('heading', { name: 'Webhooks' }) });
  await section.getByRole('button', { name: 'Add a webhook' }).click();
  await section.getByLabel('Webhook URL').fill(`https://hooks.example.test/${SECRET}`);
  await section.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(section.getByText('Address kept: https://hooks.example.test/')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(SECRET);
  await page.reload();
  await expect(page.locator('body')).not.toContainText(SECRET);
  await expect(page.getByText('Address kept:')).toBeVisible();
});

test('says where the API key comes from, and leaves it alone when a variable sets it', async ({
  page,
}) => {
  // The stack starts with KINOSHELF_API_KEY: replacing it here would be undone at the next start,
  // so the page points to the variable instead of offering the button. The replacement itself is
  // covered by the server's tests.
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'API key' }) });
  await expect(section.getByText('The key comes from KINOSHELF_API_KEY')).toBeVisible();
  await expect(section.getByRole('button', { name: 'Replace the API key' })).toHaveCount(0);
});

test('leaves the TMDB key alone when a variable sets it', async ({ page }) => {
  // The stack starts with TMDB_API_KEY, which wins over anything saved here.
  await expect(page.getByLabel('New TMDB key')).toBeDisabled();
  await expect(page.getByText('Set by the TMDB_API_KEY variable')).toBeVisible();
});

test('jumps to a section from the side menu and follows the scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  const menu = page.getByRole('navigation', { name: 'On this page' });
  await expect(menu.getByRole('button', { name: 'TMDB & languages' })).toHaveAttribute(
    'aria-current',
    'true',
  );

  await menu.getByRole('button', { name: 'Webhooks' }).click();
  await expect(page.getByRole('heading', { name: 'Webhooks', exact: true })).toBeInViewport();
  await expect(menu.getByRole('button', { name: 'Webhooks' })).toHaveAttribute(
    'aria-current',
    'true',
  );

  // Webhooks is too near the end to reach the top: the highlight must stay on it once the scroll
  // is over, not move to the sections crossed or to the last one.
  await expect
    .poll(async () => {
      const before = await page.evaluate('window.scrollY');
      await page.waitForTimeout(200);
      return before === (await page.evaluate('window.scrollY'));
    })
    .toBe(true);
  await expect(menu.getByRole('button', { name: 'Webhooks' })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(menu.locator('[aria-current]')).toHaveCount(1);

  await page.keyboard.press('Home');
  await expect(menu.getByRole('button', { name: 'TMDB & languages' })).toHaveAttribute(
    'aria-current',
    'true',
  );
});
