import { expect, test } from '@playwright/test';
import { signIn } from './helpers.js';

test('refuses a wrong key, accepts the right one, and signs out', async ({ page }) => {
  await page.goto('/libraries');
  await page.getByLabel('API key').fill('not-the-key');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Wrong API key');

  await signIn(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('keeps the session across a reload and sends a deep link to its page', async ({ page }) => {
  await signIn(page);
  await page.goto('/history');
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
});

test('switches the language of the whole UI', async ({ page }) => {
  await signIn(page);
  await page.getByLabel('Language').selectOption('fr');
  await expect(page.getByRole('heading', { name: 'Bibliothèques' })).toBeVisible();
  await page.getByLabel('Langue').selectOption('en');
  await expect(page.getByRole('heading', { name: 'Libraries' })).toBeVisible();
});

test('folds the header tools behind a button on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await signIn(page);
  const signOut = page.getByRole('button', { name: 'Sign out' });
  const tools = page.getByRole('button', { name: 'Preferences' });

  // The logo and one line of menus: the header does not take a third of the screen.
  await expect(tools).toBeVisible();
  await expect(signOut).toBeHidden();
  const height = await page.evaluate<number>("document.querySelector('header').offsetHeight");
  expect(height).toBeLessThan(120);

  await tools.click();
  await expect(tools).toHaveAttribute('aria-expanded', 'true');
  await expect(signOut).toBeVisible();
  await expect(page.getByLabel('Language')).toBeVisible();

  // A menu over the page, not a block under the header: the header keeps its height.
  const open = await page.evaluate<number>("document.querySelector('header').offsetHeight");
  expect(open).toBe(height);
  await page.keyboard.press('Escape');
  await expect(signOut).toBeHidden();
  await expect(tools).toBeFocused();
  await tools.click();
  await expect(signOut).toBeVisible();
  await page.getByRole('main').click({ position: { x: 5, y: 300 } });
  await expect(signOut).toBeHidden();
  await tools.click();
  await expect(signOut).toBeVisible();
  await tools.click();
  await expect(signOut).toBeHidden();

  // A tablet width folds them too, the menus and the button sharing the logo's line.
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(tools).toBeVisible();
  const tablet = await page.evaluate<number>("document.querySelector('header').offsetHeight");
  expect(tablet).toBeLessThan(90);

  // On a desktop width they are all there and the button is not.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(tools).toBeHidden();
  await expect(signOut).toBeVisible();
});
