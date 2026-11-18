import { expect, test } from '@playwright/test';
import { signIn } from './helpers.js';

test('explains a button in a tip that opens on focus and closes on Escape', async ({ page }) => {
  await signIn(page);
  await page.goto('/arrivals');

  const button = page.getByRole('button', { name: 'Analyse everything again' });
  await expect(page.getByRole('tooltip')).toBeHidden();

  await button.focus();
  const tip = page.getByRole('tooltip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('every file of the arrival folders is analysed again');
  // The button is tied to its help for a screen reader.
  await expect(button).toHaveAccessibleDescription(/analysed again/);

  await page.keyboard.press('Escape');
  await expect(tip).toBeHidden();
});
