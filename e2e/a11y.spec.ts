import { test, expect } from '@playwright/test';
import { resetAppState, createFirstFile, openPalette } from './helpers';

test.describe('Accessibility - skip link and focus trap', () => {
	test.beforeEach(async ({ page }) => {
		await resetAppState(page);
	});

	test('keeps the #main skip link hidden until focus', async ({ page }) => {
		const link = page.locator('a.skip-link');
		await expect(link).toBeAttached();
		await expect(link).toHaveAttribute('href', '#main');

		const left = await link.evaluate((el) => getComputedStyle(el).left);
		expect(left).toBe('-9999px');

		await createFirstFile(page);
		const main = page.locator('#main');
		await expect(main).toBeAttached();
		await expect(main).toHaveAttribute('tabindex', '-1');
	});

	test('CommandPalette - wraps Tab from the last focusable element', async ({ page }) => {
		await createFirstFile(page);
		await openPalette(page);
		const dialog = page.getByRole('dialog', { name: 'Palette de commandes' });

		const focusables = dialog.locator(
			'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
		);
		const count = await focusables.count();
		expect(count).toBeGreaterThan(1);

		// Focus the last element. Tab must move focus to the first input.
		await focusables.nth(count - 1).focus();
		await page.keyboard.press('Tab');
		await expect(dialog.locator('input[type="text"]')).toBeFocused();
	});

	test('CommandPalette - wraps Shift+Tab from the first focusable element', async ({ page }) => {
		await createFirstFile(page);
		await openPalette(page);
		const dialog = page.getByRole('dialog', { name: 'Palette de commandes' });

		const focusables = dialog.locator(
			'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
		);
		const count = await focusables.count();

		// Focus the first input. Shift+Tab must move focus to the last element.
		await dialog.locator('input[type="text"]').focus();
		await page.keyboard.press('Shift+Tab');
		await expect(focusables.nth(count - 1)).toBeFocused();
	});
});
