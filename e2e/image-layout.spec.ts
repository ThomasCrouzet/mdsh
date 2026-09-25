import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createFirstFile, resetAppState, writeSourceContent } from './helpers';

test.describe('Embedded image editing and layout', () => {
	test.beforeEach(async ({ page }) => {
		await resetAppState(page);
		await createFirstFile(page);
	});

	test('hides image payloads and keeps the original bytes through editing and export', async ({
		page
	}, testInfo) => {
		const payload = (await readFile('static/pwa-192x192.png')).toString('base64');
		const image = `![Local image](data:image/png;base64,${payload})`;
		await writeSourceContent(page, `# Image data\n\n${image}\n\nLast paragraph.`);
		const source = page.locator('.cm-content');
		await expect(source).not.toContainText(payload);
		await expect(
			source.getByRole('button', { name: 'Afficher les données de l’image' })
		).toBeVisible();
		await source.click();
		await page.keyboard.press('ControlOrMeta+End');
		await page.keyboard.insertText(' More text.');
		await expect(source).toContainText('More text.');
		await page.keyboard.press('ControlOrMeta+z');
		await expect(source).not.toContainText('More text.');
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y');
		await expect(source).toContainText('More text.');
		await page.locator('button[data-mode="read"]').click();
		await expect(page.locator('.mdsh-preview img')).toHaveAttribute(
			'src',
			`data:image/png;base64,${payload}`
		);
		await page.locator('button[data-mode="source"]').click();
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						new Promise<boolean>((resolve, reject) => {
							const request = indexedDB.open('mdsh');
							request.onerror = () => reject(request.error);
							request.onsuccess = () => {
								const db = request.result;
								const query = db.transaction('drafts').objectStore('drafts').getAll();
								query.onsuccess = () => {
									db.close();
									resolve(
										query.result.some((draft: { content: string }) =>
											draft.content.includes('More text.')
										)
									);
								};
								query.onerror = () => {
									db.close();
									reject(query.error);
								};
							};
						})
				)
			)
			.toBe(true);
		await page.reload();
		await expect(
			source.getByRole('button', { name: 'Afficher les données de l’image' })
		).toBeVisible();
		await expect(source).toContainText('More text.');
		const download = page.waitForEvent('download');
		await page.keyboard.press('ControlOrMeta+s');
		const path = testInfo.outputPath('embedded-image.md');
		await (await download).saveAs(path);
		expect(await readFile(path, 'utf8')).toContain(image);
		await source.getByRole('button', { name: 'Afficher les données de l’image' }).focus();
		await page.keyboard.press('Enter');
		await expect(source).toContainText(payload);
		await testInfo.attach('portable-markdown', { path, contentType: 'text/markdown' });
	});

	test('keeps all pixels visible when the PDF guide and viewport shrink', async ({
		page
	}, testInfo) => {
		await page.setViewportSize({ width: 1500, height: 1000 });
		const image = await page.evaluate(() => {
			const canvas = document.createElement('canvas');
			canvas.width = 1800;
			canvas.height = 600;
			const context = canvas.getContext('2d')!;
			context.fillStyle = '#00aa00';
			context.fillRect(0, 0, 1800, 600);
			context.fillStyle = '#ff0000';
			context.fillRect(0, 0, 1800, 30);
			context.fillStyle = '#0000ff';
			context.fillRect(0, 570, 1800, 30);
			return canvas.toDataURL();
		});
		await writeSourceContent(page, `# Image width\n\n![Wide image](${image})`);
		await page.locator('button[data-mode="wysiwyg"]').click();
		const picture = page.locator('.milkdown-image-block img');
		await expect(picture).toBeVisible({ timeout: 20_000 });
		await page.keyboard.press('ControlOrMeta+,');
		await page.getByRole('button', { name: 'PDF (A4)', exact: true }).click();
		await page.getByRole('button', { name: 'Fermer', exact: true }).click();
		for (const width of [1500, 850, 1200]) {
			await page.setViewportSize({ width, height: 1000 });
			await expect
				.poll(() =>
					picture.evaluate((element) => {
						const rect = element.getBoundingClientRect();
						return Math.abs(rect.width / rect.height - 3);
					})
				)
				.toBeLessThan(0.02);
			const metrics = await picture.evaluate((element) => {
				const rect = element.getBoundingClientRect();
				const parent = element.closest('.ProseMirror')!;
				const style = getComputedStyle(parent);
				return {
					right: rect.right,
					limit: parent.getBoundingClientRect().right - parseFloat(style.paddingRight)
				};
			});
			expect(metrics.right).toBeLessThanOrEqual(metrics.limit + 1);
		}
		await testInfo.attach('pdf-width-image', {
			body: await page.screenshot(),
			contentType: 'image/png'
		});
	});
});
