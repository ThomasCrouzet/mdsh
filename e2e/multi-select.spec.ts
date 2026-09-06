import { test, expect, type Page } from '@playwright/test';
import { resetAppState } from './helpers';

// §6.5 - Sidebar multi-selection: Cmd+click toggle, Shift+click range,
// and grouped actions for ZIP export, close, and deselect.
//
// Create three files from the sidebar to test selection ranges.
// This local helper creates N files named "Sans titre*.md" from the sidebar.

async function createFiles(page: Page, count: number) {
	// Open the sidebar. It is already visible on desktop, but CI can use the mobile
	// button. The toggle is idempotent.
	const welcomeBtn = page.locator('main').getByRole('button', { name: /Nouveau fichier/ });
	await welcomeBtn.click();
	await expect(page.locator('input[aria-label^="Nom du fichier"]')).toBeVisible({
		timeout: 10_000
	});
	// Create later files from the "Nouveau fichier" sidebar button.
	const sidebarNewBtn = page.locator('aside').getByRole('button', { name: /Nouveau fichier/ });
	for (let i = 1; i < count; i++) {
		await sidebarNewBtn.click();
		// Wait one tick for the store to create the file.
		await page.waitForTimeout(50);
	}
	// Wait for N items in the sidebar list.
	await expect(page.locator('aside ul[aria-label*="Fichiers ouverts"] > li')).toHaveCount(count, {
		timeout: 5000
	});
}

test.describe('§6.5 - Sidebar multi-selection', () => {
	test.beforeEach(async ({ page }) => {
		await resetAppState(page);
	});

	test('shows grouped actions after Cmd+click and Shift+click', async ({ page }) => {
		await createFiles(page, 3);

		// Select file buttons by `data-file-id`. This attribute is not on Close buttons
		// and is more stable than the "Sans titre" label.
		const fileButtons = page.locator('aside button[data-file-id]');
		await expect(fileButtons).toHaveCount(3);

		const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
		await fileButtons.nth(0).click({ modifiers: [mod] });
		await fileButtons.nth(2).click({ modifiers: [mod] });

		// The grouped action bar must appear after two selections.
		const actionsBar = page.locator('aside [aria-label="Actions sur la sélection"]');
		await expect(actionsBar).toBeVisible();
		await expect(actionsBar).toContainText('2 sélectionnés');

		// Shift+click the second file to extend the selection from the last anchor.
		// All three files must be selected.
		await fileButtons.nth(1).click({ modifiers: ['Shift'] });
		await expect(actionsBar).toContainText('3 sélectionnés');
	});

	test('moves all selected files to trash from the Close button', async ({ page }) => {
		await createFiles(page, 3);
		const fileButtons = page.locator('aside button[data-file-id]');

		const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
		// Select all three files with a full Shift+click range.
		await fileButtons.nth(0).click({ modifiers: [mod] });
		await fileButtons.nth(2).click({ modifiers: ['Shift'] });

		const actionsBar = page.locator('aside [aria-label="Actions sur la sélection"]');
		await expect(actionsBar).toContainText('3 sélectionnés');

		// Click "Fermer la sélection" to close all selected files.
		await actionsBar.getByRole('button', { name: 'Fermer la sélection' }).click();

		// The files move to trash and the list becomes empty. The action bar hides when
		// selectedIds is empty.
		await expect(actionsBar).not.toBeVisible({ timeout: 5000 });
		await expect(fileButtons).toHaveCount(0, { timeout: 5000 });
	});
});
