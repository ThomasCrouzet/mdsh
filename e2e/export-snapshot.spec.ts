import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resetAppState, seedFiles, writeSourceContent } from './helpers';

test.use({ serviceWorkers: 'block' });

test('selection ZIP keeps its starting content while the export module loads', async ({
	page
}, testInfo) => {
	const { default: JSZip } = await import('jszip');
	await resetAppState(page);
	await seedFiles(page, [
		{ name: 'other', content: '# Other' },
		{ name: 'snapshot', content: '# Export snapshot' }
	]);
	let release: () => void = () => {};
	const waiting = new Promise<void>((resolve) => {
		release = resolve;
	});
	let paused = false;
	await page.route('**/_app/immutable/chunks/*.js', async (route) => {
		const response = await route.fetch();
		if ((await response.text()).includes('JSZip')) {
			paused = true;
			await waiting;
		}
		await route.fulfill({ response });
	});
	try {
		await page
			.locator('aside button[data-file-id]')
			.first()
			.click({ modifiers: ['ControlOrMeta'] });
		await page
			.locator('aside button[data-file-id]')
			.last()
			.click({ modifiers: ['ControlOrMeta'] });
		const download = page.waitForEvent('download');
		await page
			.locator('aside [aria-label="Actions sur la sélection"]')
			.getByRole('button', { name: /ZIP/ })
			.click();
		await expect.poll(() => paused).toBe(true);
		await writeSourceContent(page, '# Later edit');
		release();
		const path = testInfo.outputPath('selection-snapshot.zip');
		await (await download).saveAs(path);
		const zip = await JSZip.loadAsync(await readFile(path));
		expect(await zip.file('snapshot.md')?.async('string')).toBe('# Export snapshot');
		await expect(page.locator('.cm-content')).toHaveText('# Later edit');
		await testInfo.attach('selection-zip', { path, contentType: 'application/zip' });
	} finally {
		release();
	}
});
