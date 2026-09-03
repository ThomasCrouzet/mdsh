import { test, expect } from '@playwright/test';
import { resetAppState, seedFiles, openPalette } from './helpers';

test.describe('Workspaces - sauvegarde/restauration de sessions', () => {
	test.beforeEach(async ({ page }) => {
		await resetAppState(page);
	});

	test('crée un workspace puis le retrouve dans le panneau Workspaces', async ({ page }) => {
		await seedFiles(page, [
			{ name: 'doc-a', content: '# A\n' },
			{ name: 'doc-b', content: '# B\n' }
		]);

		// Sauvegarde du workspace via la palette → prompt → nom → Enter.
		await openPalette(page);
		await page.keyboard.type('Sauvegarder le workspace courant');
		await expect(
			page.getByRole('option', { name: 'Sauvegarder le workspace courant', exact: true })
		).toBeVisible();
		await page.keyboard.press('Enter');
		const promptDialog = page.getByRole('dialog', { name: 'Nom du workspace ?' });
		await expect(promptDialog).toBeVisible({ timeout: 5000 });
		const promptInput = promptDialog.locator('input[type="text"]');
		await promptInput.fill('Mon workspace');
		await promptInput.press('Enter');
		// Le store ferme le prompt → re-poll pour ne pas chevaucher avec la palette.
		await expect(promptDialog).toBeHidden({ timeout: 5000 });

		// Ouverture du panneau Workspaces via la commande "Charger un workspace…".
		await openPalette(page);
		await page.keyboard.type('Charger un workspace');
		await page.keyboard.press('Enter');
		const wsDialog = page.getByRole('dialog', { name: 'Workspaces' });
		await expect(wsDialog).toBeVisible({ timeout: 5000 });
		await expect(wsDialog.getByText('Mon workspace')).toBeVisible();
	});
});
