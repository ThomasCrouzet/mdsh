import { test, expect } from '@playwright/test';
import { resetAppState, seedFiles, openPalette } from './helpers';

test.describe('Workspaces - save and restore sessions', () => {
	test.beforeEach(async ({ page }) => {
		await resetAppState(page);
	});

	test('creates a workspace and shows it in the Workspaces panel', async ({ page }) => {
		await seedFiles(page, [
			{ name: 'doc-a', content: '# A\n' },
			{ name: 'doc-b', content: '# B\n' }
		]);

		// Save the workspace from the palette, enter its name, and press Enter.
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
		// Wait for the store to close the prompt before the palette opens.
		await expect(promptDialog).toBeHidden({ timeout: 5000 });

		// Open the Workspaces panel with the "Charger un workspace..." command.
		await openPalette(page);
		await page.keyboard.type('Charger un workspace');
		await page.keyboard.press('Enter');
		const wsDialog = page.getByRole('dialog', { name: 'Workspaces' });
		await expect(wsDialog).toBeVisible({ timeout: 5000 });
		await expect(wsDialog.getByText('Mon workspace')).toBeVisible();
	});
});
