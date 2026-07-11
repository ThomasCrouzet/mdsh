import { test, expect } from '@playwright/test';
import { resetAppState, createFirstFile, openPalette } from './helpers';

test.describe('Command palette', () => {
	test.beforeEach(async ({ page }) => {
		await resetAppState(page);
		await createFirstFile(page);
	});

	test("s'ouvre, filtre, se ferme avec Escape", async ({ page }) => {
		await openPalette(page);
		const dialog = page.getByRole('dialog', { name: 'Palette de commandes' });

		// L'input est focusé
		const input = dialog.locator('input[type="text"]');
		await expect(input).toBeFocused();

		// Filtre "wysiwyg" → exactement 1 commande (Mode WYSIWYG)
		await input.fill('wysiwyg');
		await expect(dialog.locator('ul li button')).toHaveCount(1);

		// Escape ferme
		await page.keyboard.press('Escape');
		await expect(dialog).not.toBeVisible();
	});

	test('change le mode en mode lecture via la palette', async ({ page }) => {
		await openPalette(page);
		const dialog = page.getByRole('dialog', { name: 'Palette de commandes' });
		// Clic direct par name pour disambiguer (plusieurs commandes contiennent
		// « mode » depuis l'ajout de typewriter / focus).
		await dialog.getByRole('button', { name: /Mode lecture/i }).click();

		// Mode lecture → le rendu preview doit apparaître
		await expect(page.locator('.mdsh-preview')).toBeVisible({ timeout: 15_000 });
	});

	test('bascule le mode focus via la palette', async ({ page }) => {
		await openPalette(page);
		const dialog = page.getByRole('dialog', { name: 'Palette de commandes' });
		await dialog.getByRole('button', { name: /Activer le mode focus/i }).click();

		await expect(page.locator('body')).toHaveClass(/focus-mode/);
	});
});
