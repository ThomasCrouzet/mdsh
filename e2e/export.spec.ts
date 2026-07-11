import { test, expect } from '@playwright/test';
import { resetAppState, seedFiles, openPalette } from './helpers';

test.describe('Exports MD / HTML / PDF / ZIP', () => {
	test.beforeEach(async ({ page }) => {
		await resetAppState(page);
	});

	test('export markdown depuis la toolbar', async ({ page }) => {
		await seedFiles(page, [{ name: 'demo', content: '# Demo\n\nContenu.\n' }]);
		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: 'Exporter' }).first().click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toMatch(/\.md$/);
	});

	test('export HTML via la palette', async ({ page }) => {
		await seedFiles(page, [{ name: 'demo', content: '# Demo\n' }]);
		await openPalette(page);
		await page.keyboard.type('Exporter en HTML');
		const downloadPromise = page.waitForEvent('download');
		await page.keyboard.press('Enter');
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toMatch(/\.html$/);
	});

	test('export ZIP via la palette regroupe tous les fichiers', async ({ page }) => {
		await seedFiles(page, [
			{ name: 'one', content: '# One\n' },
			{ name: 'two', content: '# Two\n' }
		]);
		await openPalette(page);
		await page.keyboard.type('Exporter tous');
		const downloadPromise = page.waitForEvent('download');
		await page.keyboard.press('Enter');
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toMatch(/\.zip$/);
	});
});
