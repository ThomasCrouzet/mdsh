import { test, expect } from '@playwright/test';
import { resetAppState, createFirstFile, openPalette } from './helpers';

test.describe('Mode focus', () => {
	test.beforeEach(async ({ page }) => {
		await resetAppState(page);
		await createFirstFile(page);
	});

	test('activation et désactivation via la palette', async ({ page }) => {
		const body = page.locator('body');
		await expect(body).not.toHaveClass(/focus-mode/);

		// Activation : clic direct sur "Activer le mode focus" pour disambiguer
		// (depuis Tier 5, plusieurs commandes contiennent « mode » et « focus »).
		await openPalette(page);
		const dialog = page.getByRole('dialog', { name: 'Palette de commandes' });
		await dialog.getByRole('button', { name: /Activer le mode focus/i }).click();
		await expect(body).toHaveClass(/focus-mode/);

		// §B1.1 - Désactivation : le header (qui contient le bouton "Palette de
		// commandes") est `inert` en focus mode → click impossible. On utilise
		// le raccourci clavier ⌘⇧P qui passe via window-level keydown.
		const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
		await page.keyboard.press(`${mod}+Shift+P`);
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: /Désactiver le mode focus/i }).click();
		await expect(body).not.toHaveClass(/focus-mode/);
	});

	test('annonce sr-only mise à jour', async ({ page }) => {
		// L'app monte 2 régions [role=status][aria-live=polite] - celle du focus
		// + celle du typewriter. On cible le live region focus par son texte initial.
		const focusStatus = page
			.locator('[role="status"][aria-live="polite"]')
			.filter({ hasText: /Mode focus/i });
		await expect(focusStatus).toContainText(/désactivé/i);

		await openPalette(page);
		const dialog = page.getByRole('dialog', { name: 'Palette de commandes' });
		await dialog.getByRole('button', { name: /Activer le mode focus/i }).click();
		await expect(focusStatus).toContainText(/activé/i);
	});
});
