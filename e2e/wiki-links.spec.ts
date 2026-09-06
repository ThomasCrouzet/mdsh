import { test, expect } from '@playwright/test';
import { resetAppState, seedFiles } from './helpers';

test.describe('Wiki-links navigation + backlinks', () => {
	test.beforeEach(async ({ page }) => {
		await resetAppState(page);
	});

	test('opens the Alice file from `[[Alice]]` in read mode', async ({ page }) => {
		await seedFiles(page, [
			{ name: 'alice', content: '# Alice\n\nContenu de Alice.\n' },
			{ name: 'bob', content: '# Bob\n\nBob référence [[alice]].\n' }
		]);
		// Bob is active because it was seeded last. Select read mode to render the wiki link.
		await page.locator('button[data-mode="read"]').click();
		const wiki = page.locator('.mdsh-preview a.wiki-link[data-mdsh-wiki]').first();
		await expect(wiki).toBeVisible({ timeout: 10_000 });
		await wiki.click();
		// The active file changes to "alice", and the toolbar shows its name.
		const nameInput = page.locator('input[aria-label^="Nom du fichier"]');
		await expect(nameInput).toHaveValue('alice', { timeout: 5000 });
	});

	test('lists incoming files in the sidebar Backlinks section', async ({ page }) => {
		await seedFiles(page, [
			// Create the target first. ref-a and ref-b link to it.
			{ name: 'cible', content: '# Cible\n\nFichier référencé.\n' },
			{ name: 'ref-a', content: '# Ref A\n\nVoir [[cible]].\n' },
			{ name: 'ref-b', content: '# Ref B\n\nAussi [[cible]].\n' }
		]);
		// Activate "cible" to show its backlinks in the sidebar.
		await page.locator('aside button[aria-label^="cible"]').first().click();
		const backlinksSection = page.locator('aside [aria-label="Backlinks"]');
		await expect(backlinksSection).toBeVisible({ timeout: 5000 });
		await expect(backlinksSection.getByText('ref-a')).toBeVisible();
		await expect(backlinksSection.getByText('ref-b')).toBeVisible();
	});
});
