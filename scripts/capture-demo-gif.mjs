#!/usr/bin/env node
/**
 * Enregistre le GIF de démo du README via Playwright + ffmpeg.
 *
 * Scénario scripté (reproductible d'une version à l'autre) : écrire du
 * markdown en WYSIWYG, basculer en source (⌘/), ouvrir la palette (⌘⇧P) et
 * le graphe de liens, cliquer un [[wiki-link]] en mode lecture.
 *
 * Pré-requis :
 *   npm run build
 *   ffmpeg installé (`brew install ffmpeg` / `apt install ffmpeg`)
 *   (le serveur preview est lancé automatiquement ci-dessous)
 *
 * Usage :
 *   node scripts/capture-demo-gif.mjs
 */
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DIR = join(ROOT, 'docs');
const OUT_GIF = join(OUT_DIR, 'demo.gif');
const VITE_BIN = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const PREVIEW_PORT = 4174;
const BASE_URL = `http://localhost:${PREVIEW_PORT}`;

const VIEWPORT = { width: 1120, height: 700 };
const GIF_WIDTH = 960;
const GIF_FPS = 12;

const FREEZE_CARET_CSS = `
	.cm-cursor, .cm-cursor-primary { animation: none !important; opacity: 1 !important; }
`;

async function waitForServer(url, timeoutMs = 60_000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const res = await fetch(url);
			if (res.ok) return;
		} catch {
			// not ready yet
		}
		await delay(500);
	}
	throw new Error(`Server ${url} did not start in time`);
}

function startPreview() {
	const child = spawn(
		process.execPath,
		[VITE_BIN, 'preview', '--port', String(PREVIEW_PORT), '--strictPort'],
		{
			cwd: ROOT,
			stdio: ['ignore', 'pipe', 'pipe']
		}
	);
	child.stdout?.on('data', (chunk) => process.stdout.write(`[preview] ${chunk}`));
	child.stderr?.on('data', (chunk) => process.stderr.write(`[preview] ${chunk}`));
	return child;
}

/** Full reset + force the English locale (the README is English-first). */
async function resetState(page) {
	await page.goto(BASE_URL);
	await page.evaluate(async () => {
		await Promise.all(
			['mdsh', 'mdsh-fs'].map(
				(name) =>
					new Promise((resolve) => {
						const req = indexedDB.deleteDatabase(name);
						req.onsuccess = () => resolve(undefined);
						req.onerror = () => resolve(undefined);
						req.onblocked = () => resolve(undefined);
					})
			)
		);
		localStorage.clear();
		localStorage.setItem('mdsh:locale', 'en');
		// Ideas/Diagrams are seeded via CodeMirror (fast, deterministic);
		// "Welcome" is switched to WYSIWYG explicitly once active (see record()).
		localStorage.setItem('mdsh:mode', 'source');
	});
	await page.reload();
	await page.waitForLoadState('networkidle');
}

async function renameActive(page, newName) {
	const input = page.locator('input[aria-label^="File name"]');
	await input.waitFor({ timeout: 5000 });
	await input.fill(newName);
	await input.press('Enter');
	await delay(400);
}

async function writeSourceContent(page, content) {
	const editor = page.locator('.cm-content').first();
	await editor.waitFor({ timeout: 5000 });
	await editor.click();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.press('Delete');
	await page.keyboard.insertText(content);
	await delay(300);
}

const IDEAS_MD = `# Ideas

- Local-first tools
- No account, no server

See also [[Diagrams]].
`;

const DIAGRAMS_MD = `# Diagrams

\`\`\`mermaid
graph LR
  A[Write] --> B[Save locally]
  B --> C[Export]
\`\`\`

Back to [[Welcome]].
`;

/**
 * The mode restored from `localStorage` at boot races with the app's own
 * boot-time persistence effect (observed while building this script: the
 * very first file created can silently land back in WYSIWYG even though
 * `mdsh:mode` was set to `source` before load). Clicking the toggle
 * explicitly, instead of trusting the pre-seeded value, sidesteps the race.
 */
async function ensureMode(page, mode) {
	await page.locator(`button[data-mode="${mode}"]`).click();
	await page.waitForSelector(mode === 'source' ? '.cm-content' : '.milkdown', { timeout: 10_000 });
}

/** Seeds the two files "Welcome" will link to, before it becomes active. */
async function seedLinkedFiles(page) {
	await page
		.locator('main')
		.getByRole('button', { name: /New file/ })
		.click();
	await ensureMode(page, 'source');
	await renameActive(page, 'Ideas');
	await writeSourceContent(page, IDEAS_MD);

	await page.locator('aside button[aria-label^="New file"]').first().click();
	await renameActive(page, 'Diagrams');
	await writeSourceContent(page, DIAGRAMS_MD);

	await page.locator('aside button[aria-label^="New file"]').first().click();
	await renameActive(page, 'Welcome');
}

async function record() {
	const videoDir = await mkdtemp(join(tmpdir(), 'mdsh-demo-'));
	const browser = await chromium.launch();
	const context = await browser.newContext({
		viewport: VIEWPORT,
		colorScheme: 'dark',
		locale: 'en-US',
		recordVideo: { dir: videoDir, size: VIEWPORT }
	});
	const page = await context.newPage();
	await page.addStyleTag({ content: FREEZE_CARET_CSS });

	await resetState(page);
	await seedLinkedFiles(page);

	// "Welcome" is active and empty - switch to WYSIWYG and type it live.
	// No `[[...]]` typed here: Milkdown's live input rules are meant for
	// standard markdown, and double brackets are not - the wiki-link is
	// added afterwards as plain text in source mode instead (see below).
	await ensureMode(page, 'wysiwyg');
	await delay(600);
	const milkdown = page.locator('.milkdown [contenteditable="true"]').first();
	await milkdown.click();
	await page.keyboard.type('# Welcome\n', { delay: 45 });
	await page.keyboard.type('A markdown workspace that never phones home.\n', { delay: 30 });
	await page.keyboard.type('- [ ] Try the WYSIWYG editor', { delay: 30 });
	await delay(1200);

	// Toggle to source mode - show the raw markdown, then append the
	// wiki-links as plain text (CodeMirror, no markdown reinterpretation risk).
	await page.keyboard.press('ControlOrMeta+/');
	const cmEditor = page.locator('.cm-content').first();
	await cmEditor.waitFor({ timeout: 10_000 });
	await delay(1000);
	await cmEditor.click();
	await page.keyboard.press('ControlOrMeta+End');
	await page.keyboard.insertText('\n\nSee also [[Ideas]] and [[Diagrams]].\n');
	await delay(800);

	// Command palette -> open the link graph.
	await page.keyboard.press('ControlOrMeta+Shift+KeyP');
	const dialog = page.getByRole('dialog', { name: 'Command palette' });
	await dialog.waitFor({ timeout: 5000 });
	const paletteInput = dialog.locator('input[type="text"]');
	await paletteInput.type('graph', { delay: 60 });
	await delay(400);
	await dialog.getByRole('button', { name: /Links graph/i }).click();
	const graphDialog = page.getByRole('dialog', { name: 'Link graph' });
	await graphDialog.waitFor({ timeout: 10_000 });
	await delay(1800);
	await page.keyboard.press('Escape');
	await delay(300);

	// Reading mode - click the [[Ideas]] wiki-link.
	await page.locator('button[data-mode="read"]').click();
	const wikiLink = page.locator('.mdsh-preview a.wiki-link[data-mdsh-wiki]').first();
	await wikiLink.waitFor({ timeout: 10_000 });
	await delay(500);
	await wikiLink.click();
	const nameInput = page.locator('input[aria-label^="File name"]');
	await nameInput.waitFor({ timeout: 5000 });
	await delay(1000);

	await context.close();
	await browser.close();

	const files = await readdir(videoDir);
	const webm = files.find((f) => f.endsWith('.webm'));
	if (!webm) throw new Error('No .webm recorded');
	const src = join(videoDir, webm);
	const dst = join(videoDir, 'demo.webm');
	await rename(src, dst);
	return dst;
}

/** Two-pass palette conversion - much better quality/size than a naive `-vf gif`. */
function convertToGif(webmPath) {
	const palette = join(dirname(webmPath), 'palette.png');
	const gen = spawnSync('ffmpeg', [
		'-y',
		'-i',
		webmPath,
		'-vf',
		`fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos,palettegen`,
		palette
	]);
	if (gen.status !== 0) throw new Error(`ffmpeg palettegen failed: ${gen.stderr}`);

	const use = spawnSync('ffmpeg', [
		'-y',
		'-i',
		webmPath,
		'-i',
		palette,
		'-filter_complex',
		`fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos[x];[x][1:v]paletteuse`,
		OUT_GIF
	]);
	if (use.status !== 0) throw new Error(`ffmpeg paletteuse failed: ${use.stderr}`);
}

async function main() {
	const ffmpegExists = spawnSync('which', ['ffmpeg']).status === 0;
	if (!ffmpegExists) {
		console.error('[mdsh] ffmpeg introuvable - `brew install ffmpeg` puis relancer.');
		process.exit(1);
	}

	await mkdir(OUT_DIR, { recursive: true });
	console.log('[mdsh] démarrage du serveur preview...');
	const preview = startPreview();
	process.on('exit', () => preview.kill());
	process.on('SIGINT', () => {
		preview.kill();
		process.exit(130);
	});

	let webmPath;
	try {
		await waitForServer(BASE_URL);
		console.log('[mdsh] enregistrement du scénario...');
		webmPath = await record();
		console.log('[mdsh] conversion en GIF...');
		convertToGif(webmPath);
		console.log(`[mdsh] GIF écrit dans ${OUT_GIF}`);
	} finally {
		preview.kill();
		if (webmPath) await rm(dirname(webmPath), { recursive: true, force: true });
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
