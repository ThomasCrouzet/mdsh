import { test, expect, type Page } from '@playwright/test';
import { resetAppState } from './helpers';

// §6.5 - Multi-sélection sidebar : Cmd+clic toggle, Shift+clic range,
// barre d'actions groupées (export ZIP / fermer / désélectionner).
//
// On crée 3 fichiers via le bouton sidebar pour pouvoir tester les ranges.
// Helper local : crée N fichiers nommés "Sans titre*.md" via la sidebar.

async function createFiles(page: Page, count: number) {
	// Ouvre la sidebar (sur viewport desktop elle est déjà visible mais le
	// bouton mobile peut être nécessaire en CI). Le toggle est idempotent.
	const welcomeBtn = page.locator('main').getByRole('button', { name: /Nouveau fichier/ });
	await welcomeBtn.click();
	await expect(page.locator('input[aria-label^="Nom du fichier"]')).toBeVisible({
		timeout: 10_000
	});
	// Les fichiers suivants : on utilise le bouton sidebar "Nouveau fichier".
	const sidebarNewBtn = page.locator('aside').getByRole('button', { name: /Nouveau fichier/ });
	for (let i = 1; i < count; i++) {
		await sidebarNewBtn.click();
		// Attendre que le store ait créé le fichier (debounce 0 ici, juste tick).
		await page.waitForTimeout(50);
	}
	// Vérification : on attend N items dans la liste sidebar
	await expect(page.locator('aside ul[aria-label*="Fichiers ouverts"] > li')).toHaveCount(count, {
		timeout: 5000
	});
}

test.describe('§6.5 - Multi-sélection sidebar', () => {
	test.beforeEach(async ({ page }) => {
		await resetAppState(page);
	});

	test("Cmd+clic et Shift+clic activent la barre d'actions groupées", async ({ page }) => {
		await createFiles(page, 3);

		// On cible les boutons fichier via `data-file-id` (le seul attribut
		// présent uniquement sur le bouton "fichier", pas sur le bouton
		// "Fermer"). Plus robuste qu'un match sur le label "Sans titre".
		const fileButtons = page.locator('aside button[data-file-id]');
		await expect(fileButtons).toHaveCount(3);

		const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
		await fileButtons.nth(0).click({ modifiers: [mod] });
		await fileButtons.nth(2).click({ modifiers: [mod] });

		// La barre d'actions groupées doit apparaître (>=2 sélectionnés)
		const actionsBar = page.locator('aside [aria-label="Actions sur la sélection"]');
		await expect(actionsBar).toBeVisible();
		await expect(actionsBar).toContainText('2 sélectionnés');

		// Shift+clic sur le 2e fichier : étend la sélection à tout le range
		// (depuis le dernier ancrage = item 2). On attend 3 sélectionnés.
		await fileButtons.nth(1).click({ modifiers: ['Shift'] });
		await expect(actionsBar).toContainText('3 sélectionnés');
	});

	test('Le bouton "Fermer" supprime tous les fichiers sélectionnés', async ({ page }) => {
		await createFiles(page, 3);
		const fileButtons = page.locator('aside button[data-file-id]');

		const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
		// Sélectionne les 3 fichiers via Shift+clic (range complet)
		await fileButtons.nth(0).click({ modifiers: [mod] });
		await fileButtons.nth(2).click({ modifiers: ['Shift'] });

		const actionsBar = page.locator('aside [aria-label="Actions sur la sélection"]');
		await expect(actionsBar).toContainText('3 sélectionnés');

		// Clic sur le bouton "Fermer la sélection" - purge tout
		await actionsBar.getByRole('button', { name: 'Fermer la sélection' }).click();

		// Les fichiers basculent dans le trash, la liste se vide. La barre
		// d'actions se cache automatiquement (selectedIds = 0).
		await expect(actionsBar).not.toBeVisible({ timeout: 5000 });
		await expect(fileButtons).toHaveCount(0, { timeout: 5000 });
	});
});
