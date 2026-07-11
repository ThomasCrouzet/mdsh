import { test, expect } from '@playwright/test';
import { resetAppState, seedFiles } from './helpers';

test.describe('Wiki-links navigation + backlinks', () => {
	test.beforeEach(async ({ page }) => {
		await resetAppState(page);
	});

	test('clic sur `[[Alice]]` en mode lecture ouvre le fichier Alice', async ({ page }) => {
		await seedFiles(page, [
			{ name: 'alice', content: '# Alice\n\nContenu de Alice.\n' },
			{ name: 'bob', content: '# Bob\n\nBob référence [[alice]].\n' }
		]);
		// Bob est actif (dernier seed). Bascule en lecture pour rendre le wiki-link.
		await page.locator('button[data-mode="read"]').click();
		const wiki = page.locator('.mdsh-preview a.wiki-link[data-mdsh-wiki]').first();
		await expect(wiki).toBeVisible({ timeout: 10_000 });
		await wiki.click();
		// Active passe sur "alice" : titre de la toolbar reflète le nom.
		const nameInput = page.locator('input[aria-label^="Nom du fichier"]');
		await expect(nameInput).toHaveValue('alice', { timeout: 5000 });
	});

	test('section Backlinks de la Sidebar liste les fichiers entrants', async ({ page }) => {
		await seedFiles(page, [
			// Cible créée en 1er, mais "ref-a" et "ref-b" linkent vers elle → backlinks.
			{ name: 'cible', content: '# Cible\n\nFichier référencé.\n' },
			{ name: 'ref-a', content: '# Ref A\n\nVoir [[cible]].\n' },
			{ name: 'ref-b', content: '# Ref B\n\nAussi [[cible]].\n' }
		]);
		// Active "cible" pour exposer ses backlinks dans la Sidebar.
		await page.locator('aside button[aria-label^="cible"]').first().click();
		const backlinksSection = page.locator('aside [aria-label="Backlinks"]');
		await expect(backlinksSection).toBeVisible({ timeout: 5000 });
		await expect(backlinksSection.getByText('ref-a')).toBeVisible();
		await expect(backlinksSection.getByText('ref-b')).toBeVisible();
	});
});
