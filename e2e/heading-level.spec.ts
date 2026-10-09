import { expect, test } from '@playwright/test';
import { createFirstFile, openPalette, resetAppState, writeSourceContent } from './helpers';
import { readFile } from 'node:fs/promises';

const FIXTURE =
	[
		'# Heading 1',
		'## Heading 2',
		'### Heading 3',
		'#### Heading 4',
		'##### Heading 5',
		'###### Heading 6',
		'Plain paragraph'
	].join('\n\n') + '\n';

test('shows each heading level on hover and at the caret without exporting the indicator', async ({
	page
}, testInfo) => {
	await resetAppState(page);
	await createFirstFile(page);
	await writeSourceContent(page, FIXTURE);
	await page.locator('button[data-mode="wysiwyg"]').click();

	const editor = page.locator('.ProseMirror');
	await expect(editor).toBeVisible({ timeout: 20_000 });

	for (let level = 1; level <= 6; level++) {
		const heading = editor.locator(`h${level}`);
		await heading.hover();
		await expect
			.poll(() =>
				heading.evaluate((element) => {
					const style = getComputedStyle(element, '::after');
					return { content: style.content.replace(/["']/g, ''), opacity: style.opacity };
				})
			)
			.toEqual({ content: `H${level}`, opacity: '1' });

		await heading.click();
		await page.getByRole('button', { name: 'Palette de commandes' }).hover();
		await expect(heading).toHaveClass(/mdsh-heading-level-active/);
		await expect
			.poll(() => heading.evaluate((element) => getComputedStyle(element, '::after').opacity))
			.toBe('1');
	}

	await editor.locator('p').click();
	await page.getByRole('button', { name: 'Palette de commandes' }).hover();
	await expect(editor.locator('.mdsh-heading-level-active')).toHaveCount(0);

	await testInfo.attach('heading-levels-edit-mode', {
		body: await page.screenshot(),
		contentType: 'image/png'
	});
	await testInfo.attach('heading-levels-fixture', {
		body: FIXTURE,
		contentType: 'text/markdown'
	});

	const markdownDownloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Exporter' }).first().click();
	const markdownDownload = await markdownDownloadPromise;
	const markdownPath = await markdownDownload.path();
	if (!markdownPath) throw new Error('The Markdown export is not available.');
	expect(await readFile(markdownPath, 'utf8')).toBe(FIXTURE);

	await openPalette(page);
	await page.getByRole('combobox').fill('Exporter en HTML');
	const downloadPromise = page.waitForEvent('download');
	await page.keyboard.press('Enter');
	const download = await downloadPromise;
	const downloadPath = await download.path();
	if (!downloadPath) throw new Error('The HTML export is not available.');
	const html = await readFile(downloadPath, 'utf8');
	expect(html).not.toContain('data-heading-level-indicator');
	expect(html).not.toContain('mdsh-heading-level');
});
