import { test, expect } from '@playwright/test';
import { resetAppState, createFirstFile, switchToSource } from './helpers';

test.describe('Golden path - persistance cycle de vie', () => {
	test.beforeEach(async ({ page }) => {
		await resetAppState(page);
	});

	test('crée un fichier, tape du contenu, recharge, contenu intact', async ({ page }) => {
		await createFirstFile(page);
		// Bascule en mode source via le bouton UI - garantit CodeMirror visible
		// y compris sur WebKit où le localStorage forcé par resetAppState peut ne
		// pas être persisté avant le reload (comportement WebKit sandbox IDB).
		await switchToSource(page);
		const cm = page.locator('.cm-content').first();
		await expect(cm).toBeVisible({ timeout: 10_000 });

		const payload = 'Bonjour\n\nContenu de test E2E';
		await cm.click();
		// CodeMirror est un contenteditable - on tape via le clavier pour simuler l'input réel.
		await page.keyboard.type(payload);

		// Attendre le debounce save (400 ms) + marge
		await page.waitForTimeout(800);

		// Recharger
		await page.reload();
		// Sur WebKit, le mode n'est pas toujours restauré via localStorage après reload
		// → on repasse explicitement en source avant de lire le contenu.
		await switchToSource(page);
		const cmAfter = page.locator('.cm-content').first();
		await expect(cmAfter).toBeVisible({ timeout: 10_000 });
		// CodeMirror rend chaque ligne dans un .cm-line ; on assemble pour comparer.
		await expect(async () => {
			const text = await cmAfter.evaluate((el) => {
				const lines = el.querySelectorAll('.cm-line');
				return Array.from(lines)
					.map((l) =>
						(l.textContent ?? '').replace(new RegExp(String.fromCharCode(0x200b), 'g'), '')
					)
					.join('\n');
			});
			expect(text).toBe(payload);
		}).toPass({ timeout: 10_000 });
	});

	test('la sidebar liste les fichiers après création', async ({ page }) => {
		await createFirstFile(page);

		// Ouvrir la sidebar explicitement (peut être fermée selon la largeur viewport)
		const toggle = page.getByRole('button', { name: 'Afficher/masquer le panneau' });
		if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');

		// Un item de fichier doit apparaître dans l'aside
		const sidebarItem = page
			.locator('aside')
			.getByText(/Sans titre/)
			.first();
		await expect(sidebarItem).toBeVisible({ timeout: 5000 });
	});
});
