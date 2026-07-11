import { test, expect } from '@playwright/test';
import { resetAppState } from './helpers';

// Spec restreinte au projet `mobile-chromium`. Sur desktop, on skip pour ne
// pas faire échouer le job par viewport incompatible (drawer non actif).
test.describe('UX mobile - drawer Sidebar', () => {
	test.beforeEach(async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'mobile-chromium', 'mobile-only');
		await resetAppState(page);
	});

	test('la Sidebar est masquée par défaut sur viewport mobile', async ({ page }) => {
		// La sidebar `<aside>` existe dans le DOM (drawer) mais doit être
		// off-screen ou non visible tant qu'on ne l'ouvre pas.
		const drawer = page.locator('aside').first();
		const isHiddenInitially = await drawer.evaluate((el) => {
			const r = el.getBoundingClientRect();
			// Soit hors viewport (translate -100 %), soit largeur 0, soit display:none.
			const style = getComputedStyle(el);
			return (
				style.display === 'none' || style.visibility === 'hidden' || r.right <= 0 || r.width === 0
			);
		});
		expect(isHiddenInitially).toBe(true);
	});

	test('le bouton Menu ouvre le drawer Sidebar', async ({ page }) => {
		// L'aria-label "Menu" est posé sur le bouton burger mobile-only de Toolbar.
		await page.getByRole('button', { name: 'Menu' }).click();
		const drawer = page.locator('aside').first();
		await expect(drawer).toBeVisible();
	});
});
