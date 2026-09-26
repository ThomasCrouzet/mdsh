import { expect, test } from '@playwright/test';
import { createFirstFile, openPalette, resetAppState, writeSourceContent } from './helpers';
import { databaseState } from './storage-evidence';
import { readFile } from 'node:fs/promises';

test.use({ serviceWorkers: 'block' });

for (const stage of [
	'consent',
	'media',
	'decode',
	'stylesheet',
	'font',
	'print-preparation'
] as const) {
	test(`cancel export at ${stage} preserves edits and permits another export`, async ({
		page
	}, info) => {
		await resetAppState(page);
		await createFirstFile(page);
		const source =
			stage === 'consent' || stage === 'media'
				? '# Export cancellation\n\n![Remote](https://export-test.invalid/image.png)'
				: stage === 'decode'
					? `# Export cancellation\n\n![Embedded](data:image/png;base64,${(await readFile('static/pwa-192x192.png')).toString('base64')})`
					: '# Export cancellation\n\nPending changes. $x^2$';
		await writeSourceContent(page, source);
		const before = await databaseState(page);
		const dirty = await page.locator('aside button[data-file-id]').getAttribute('aria-label');
		let release!: () => void;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		let requested = false;
		let downloads = 0;
		page.on('download', () => downloads++);
		const url =
			stage === 'font'
				? '**/katex/fonts/*'
				: stage === 'stylesheet' || stage === 'print-preparation'
					? '**/print/print.css'
					: 'https://export-test.invalid/image.png';
		await page.route(url, async (route) => {
			requested = true;
			await held;
			await route.abort().catch(() => {});
		});
		if (stage === 'decode')
			await page.evaluate(() => {
				const original = window.createImageBitmap;
				let resume!: () => void;
				const gate = new Promise<void>((resolve) => {
					resume = resolve;
				});
				window.createImageBitmap = ((image: ImageBitmapSource) => {
					document.documentElement.dataset.exportDecode = 'waiting';
					return gate.then(() => original(image));
				}) as typeof createImageBitmap;
				window.addEventListener(
					'release-export-decode',
					() => {
						window.createImageBitmap = original;
						resume();
					},
					{ once: true }
				);
			});
		try {
			await openPalette(page);
			await page
				.getByRole('combobox')
				.fill(stage === 'print-preparation' ? 'Exporter en PDF' : 'Exporter en HTML');
			await page.keyboard.press('Enter');
			if (stage === 'consent' || stage === 'media') {
				const consent = page.getByRole('dialog', { name: 'Incorporer les images externes ?' });
				await expect(consent).toBeVisible();
				if (stage === 'consent')
					await consent.getByRole('button', { name: 'Annuler', exact: true }).click();
				else await consent.getByRole('button', { name: 'Autoriser et exporter' }).click();
			}
			if (stage !== 'consent') {
				if (stage === 'decode')
					await expect(page.locator('html')).toHaveAttribute('data-export-decode', 'waiting');
				else await expect.poll(() => requested).toBe(true);
				await page.getByRole('button', { name: 'Annuler l’export' }).click();
			}
			await expect(page.locator('.spinner')).toHaveCount(0, { timeout: 2000 });
			expect(await page.locator('aside button[data-file-id]').getAttribute('aria-label')).toBe(
				dirty
			);
			expect((await databaseState(page)).drafts).toEqual(before.drafts);
			expect(downloads).toBe(0);
			expect(requested).toBe(stage !== 'consent' && stage !== 'decode');
			await expect(page.locator('#mdsh-native-print, iframe[aria-hidden="true"]')).toHaveCount(0);
		} finally {
			release();
			await page.unroute(url);
			await page.evaluate(() => window.dispatchEvent(new Event('release-export-decode')));
		}
		await writeSourceContent(page, '# Export recovered\n\nStill editable.');
		await openPalette(page);
		await page.getByRole('combobox').fill('Exporter en HTML');
		const downloaded = page.waitForEvent('download');
		await page.keyboard.press('Enter');
		const path = info.outputPath('recovered.html');
		await (await downloaded).saveAs(path);
		await expect(page.locator('.spinner')).toHaveCount(0);
		await expect(page.locator('.cm-content')).toContainText('Still editable.');
		expect(downloads).toBe(1);
		await info.attach('subsequent-export', { path, contentType: 'text/html' });
		await info.attach('cancellation.json', {
			body: JSON.stringify({ stage, source, dirty, requested, downloads }),
			contentType: 'application/json'
		});
	});
}
