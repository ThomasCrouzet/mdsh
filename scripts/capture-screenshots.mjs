#!/usr/bin/env node
/**
 * Capture the current dark and light interface from the built app.
 * After UI integration: npm run build && node scripts/capture-screenshots.mjs
 * The script starts and stops its own preview server on port 4173.
 * CAPTURE_PORT and BASE_PATH can select another port and built base path.
 *
 * The four existing PWA names remain 2560 x 1600 WebP images.
 * docs/screenshots also receives light variants and both welcome screens.
 * Use cwebp for lossless stills and ffprobe to check their dimensions.
 * PNG sources, checksums, and results stay under test-results/.
 */
import { expect } from '@playwright/test';
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
	ROOT,
	IDEAS,
	DIAGRAMS,
	FIELD_NOTES,
	ensureMode,
	fileEvidence,
	newCapturePage,
	openPalette,
	probeMedia,
	runTool,
	saveScreenshot,
	seedDocuments,
	withCapture
} from './capture-helpers.mjs';

const PWA_NAMES = ['mode-wysiwyg', 'mode-source', 'mode-read', 'palette'];

async function captureTheme(session, theme) {
	const page = await newCapturePage(session, theme);
	const shots = [];
	async function capture(name) {
		const stem = `${name}${theme === 'light' ? '-light' : ''}`;
		const png = join(session.evidenceDir, `${stem}.png`);
		const webp = join(session.evidenceDir, `${stem}.webp`);
		await saveScreenshot(page, png);
		const args = ['-quiet', '-lossless', '-z', '9', png, '-o', webp];
		runTool('cwebp', args);
		const media = probeMedia(webp);
		expect(media.streams[0].width).toBe(2560);
		expect(media.streams[0].height).toBe(1600);
		shots.push({
			name: `${stem}.webp`,
			theme,
			pwa: theme === 'dark' && PWA_NAMES.includes(name),
			...(await fileEvidence(webp)),
			media,
			encoder: { command: 'cwebp', args }
		});
		console.log(`[capture] ${stem}.webp`);
	}

	await expect(page.locator('#welcome-title')).toBeVisible();
	await capture('welcome');
	await seedDocuments(page, [IDEAS, DIAGRAMS, FIELD_NOTES]);
	await expect(page.locator('.mdsh-file-row')).toHaveCount(3);
	await expect(page.locator('aside nav[aria-label="Backlinks"] button')).toHaveCount(2);

	// Capture the original source before the visual editor normalizes Markdown.
	await ensureMode(page, 'source');
	await page.locator('.cm-content').click();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.press('ArrowLeft');
	await expect(page.locator('.cm-content .cm-line').first()).toHaveText('# Field notes');
	await capture('mode-source');

	await ensureMode(page, 'read');
	const preview = page.locator('.mdsh-preview');
	await expect(preview.locator('h1')).toHaveText('Field notes');
	await expect(preview.locator('.katex')).toBeVisible();
	await expect(preview.locator('pre code')).toContainText('const note');
	await expect(preview.locator('a.wiki-link')).toHaveCount(2);
	await expect(page.locator('.mdsh-toc-col')).toBeVisible();
	await capture('mode-read');

	const palette = await openPalette(page);
	await expect(palette.getByRole('combobox')).toHaveValue('');
	await capture('palette');
	await palette.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(palette).not.toBeVisible();

	await ensureMode(page, 'wysiwyg');
	const editor = page.locator('.milkdown .ProseMirror');
	await expect(editor.locator('h1')).toHaveText('Field notes');
	await expect(editor).toContainText('Export a PDF');
	await expect(editor.locator('.katex').first()).toBeVisible();
	await capture('mode-wysiwyg');
	await page.context().close();
	return shots;
}

withCapture('screenshots', 4173, async (session) => {
	session.metadata.cwebpVersion = runTool('cwebp', ['-version']);
	const shots = [];
	for (const theme of ['dark', 'light']) shots.push(...(await captureTheme(session, theme)));
	expect(session.metadata.pageErrors).toEqual([]);
	expect(session.metadata.httpErrors).toEqual([]);
	const docsDir = join(ROOT, 'docs', 'screenshots');
	const staticDir = join(ROOT, 'static', 'screenshots');
	await mkdir(docsDir, { recursive: true });
	await mkdir(staticDir, { recursive: true });
	// Publish only after both themes pass. PWA images are exact copies of the stills.
	for (const shot of shots) {
		const source = join(session.evidenceDir, shot.name);
		await copyFile(source, join(docsDir, shot.name));
		if (shot.pwa) await copyFile(source, join(staticDir, shot.name));
	}
	return { documents: [IDEAS, DIAGRAMS, FIELD_NOTES], shots };
}).catch((error) => {
	console.error(error);
	process.exitCode ||= 1;
});
