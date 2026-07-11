import { test, expect } from '@playwright/test';
import { resetAppState } from './helpers';

test.describe('Document de démo (Welcome)', () => {
	test.beforeEach(async ({ page }) => {
		await resetAppState(page);
	});

	test('le bouton "Ouvrir un document de démo" crée 3 fichiers wiki-liés et ouvre la sidebar', async ({
		page
	}) => {
		const demoBtn = page.locator('main').getByRole('button', { name: /document de démo/ });
		await demoBtn.click();

		// Le fichier "Welcome to the mdsh demo" est actif (1er créé par loadDemo).
		const nameInput = page.locator('input[aria-label^="Nom du fichier"]');
		await expect(nameInput).toHaveValue('Welcome to the mdsh demo', { timeout: 10_000 });

		// La sidebar s'ouvre automatiquement et liste les 3 fichiers de démo.
		const sidebar = page.locator('aside');
		await expect(sidebar.getByText('Math and diagrams').first()).toBeVisible({ timeout: 5000 });
		await expect(sidebar.getByText('Task list').first()).toBeVisible();

		// Les deux autres fichiers linkent vers celui-ci → backlinks visibles.
		const backlinksSection = sidebar.locator('[aria-label="Backlinks"]');
		await expect(backlinksSection).toBeVisible({ timeout: 5000 });
		await expect(backlinksSection.getByText('Math and diagrams')).toBeVisible();
		await expect(backlinksSection.getByText('Task list')).toBeVisible();
	});
});
