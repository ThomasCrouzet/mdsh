import { expect, test } from '@playwright/test';
import { createFirstFile, resetAppState, writeSourceContent } from './helpers';

function channel(value: number): number {
	const normalized = value / 255;
	return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function luminance(rgb: number[]): number {
	return 0.2126 * channel(rgb[0]!) + 0.7152 * channel(rgb[1]!) + 0.0722 * channel(rgb[2]!);
}

function contrast(foreground: number[], background: number[]): number {
	const light = Math.max(luminance(foreground), luminance(background));
	const dark = Math.min(luminance(foreground), luminance(background));
	return (light + 0.05) / (dark + 0.05);
}

function rgb(value: string): number[] {
	const channels = value
		.match(/[\d.]+/g)
		?.slice(0, 3)
		.map(Number);
	if (!channels || channels.length !== 3) throw new Error(`Unsupported color: ${value}`);
	return channels;
}

test('keeps the link editor readable in the light theme', async ({ page }, testInfo) => {
	await resetAppState(page);
	await createFirstFile(page);
	await writeSourceContent(page, 'Readable link');
	await page.evaluate(() => localStorage.setItem('mdsh:theme', 'light'));
	await expect(page.locator('.mdsh-local-indicator')).toHaveText('Prêt hors ligne', {
		timeout: 20_000
	});
	await page.reload();
	await page.locator('button[data-mode="wysiwyg"]').click();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

	await page.locator('.ProseMirror p').selectText();
	const linkButton = page.locator('.milkdown-toolbar [data-toolbar-item="link"]');
	await expect(linkButton).toBeVisible();
	await linkButton.click();

	const input = page.locator('.milkdown-link-edit input');
	await expect(input).toBeVisible();
	await input.fill('https://example.com/readable');
	await expect(input).toHaveValue('https://example.com/readable');

	const colors = await input.evaluate((element) => {
		const foreground = getComputedStyle(element).color;
		const panel = element.closest('.link-edit');
		if (!(panel instanceof HTMLElement)) throw new Error('The link editor panel is missing.');
		const background = getComputedStyle(panel).backgroundColor;
		const themeForeground = getComputedStyle(element.closest('.milkdown')!).color;
		return { foreground, background, themeForeground };
	});
	const ratio = contrast(rgb(colors.foreground), rgb(colors.background));
	expect(colors.foreground).toBe(colors.themeForeground);
	expect(ratio).toBeGreaterThanOrEqual(4.5);

	await testInfo.attach('light-link-editor', {
		body: await page.screenshot(),
		contentType: 'image/png'
	});
	await testInfo.attach('light-link-editor-contrast', {
		body: JSON.stringify({ ...colors, ratio }, null, 2),
		contentType: 'application/json'
	});
});
