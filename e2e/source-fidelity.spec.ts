import { test, expect } from '@playwright/test';
import { resetAppState, seedFiles, openPalette } from './helpers';

test('a visual editor visit preserves the exact Markdown source without an edit', async ({
	page
}, info) => {
	await resetAppState(page);
	const source =
		'---\ntitle: Source fidelity\n---\n\nHeading\n=======\n\n* first\n* second\n\n[Example][target]\n\n[target]: https://example.invalid/ "Title"\n\n~~~text\nraw sample\n~~~\n\n<div>Raw HTML</div>\n';
	await seedFiles(page, [{ name: 'fidelity', content: source }]);
	await page.locator('[data-mode=wysiwyg]').click();
	await expect(page.locator('.ProseMirror')).toBeVisible();
	await page.locator('[data-mode=read]').click();
	await expect(page.locator('.mdsh-preview h1')).toHaveText('Heading');
	await page.locator('[data-mode=source]').click();
	await openPalette(page);
	await page.getByRole('combobox').fill('Exporter tous les fichiers (ZIP)');
	const download = page.waitForEvent('download');
	await page.keyboard.press('Enter');
	const chunks: Buffer[] = [];
	for await (const chunk of (await (await download).createReadStream())!) chunks.push(chunk);
	const bytes = Buffer.concat(chunks);
	const zip = await (await import('jszip')).default.loadAsync(bytes);
	expect(await zip.file('fidelity.md')!.async('string')).toBe(source);
	await info.attach('source.md', { body: source, contentType: 'text/markdown' });
	await info.attach('unchanged-source.zip', { body: bytes, contentType: 'application/zip' });
});

test('library export rejects more than 300 documents before a download', async ({ page }, info) => {
	await resetAppState(page);
	await page.evaluate(
		() =>
			new Promise<void>((resolve, reject) => {
				const request = indexedDB.open('mdsh');
				request.onerror = () => reject(request.error);
				request.onsuccess = () => {
					const db = request.result;
					const tx = db.transaction('drafts', 'readwrite');
					for (let i = 0; i < 301; i++)
						tx.objectStore('drafts').put({
							id: `limit-${i}`,
							name: `limit-${i}.md`,
							content: '# Limit',
							updatedAt: Date.now(),
							order: i,
							open: false
						});
					tx.oncomplete = () => {
						db.close();
						resolve();
					};
					tx.onabort = () => {
						db.close();
						reject(tx.error);
					};
				};
			})
	);
	await page.reload();
	const downloads: string[] = [];
	page.on('download', (download) => downloads.push(download.suggestedFilename()));
	await openPalette(page);
	await page.getByRole('combobox').fill('Exporter tous les fichiers (ZIP)');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('alert')).toContainText('La création du ZIP a échoué.');
	expect(downloads).toEqual([]);
	await info.attach('library-limit.png', {
		body: await page.screenshot(),
		contentType: 'image/png'
	});
});
