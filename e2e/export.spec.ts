import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
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
		await seedFiles(page, [
			{
				name: 'demo',
				content: '## test défaut c.a.c\n\n- [ ] Case non cochée\n- [X] Case cochée\n'
			}
		]);
		await openPalette(page);
		await page.keyboard.type('Exporter en HTML');
		const downloadPromise = page.waitForEvent('download');
		await page.keyboard.press('Enter');
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toMatch(/\.html$/);

		const downloadPath = await download.path();
		expect(downloadPath).not.toBeNull();
		if (!downloadPath) throw new Error('Le fichier HTML exporté est introuvable');
		const html = await readFile(downloadPath, 'utf8');

		expect(html).toContain('<ul class="contains-task-list">');
		expect(html.match(/<li class="task-list-item">/g)).toHaveLength(2);
		expect(html).toMatch(/li\.task-list-item\s*\{[^}]*list-style:\s*none;/s);
		expect(html).not.toContain('class="mdsh-anchor"');
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
