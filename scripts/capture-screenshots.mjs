#!/usr/bin/env node
/**
 * Capture README screenshots with Playwright.
 * Start the production preview server, run each scenario, and write PNG files to docs/screenshots/.
 *
 * Prerequisite:
 *   npm run build
 * The script starts the preview server automatically.
 *
 * Usage:
 *   node scripts/capture-screenshots.mjs
 *
 * For repeatable screenshots:
 * - Use a fixed 1280x800 viewport and DPR 2 (retina PNG).
 * - Disable CSS animations, transitions, the CodeMirror cursor, and the spinner.
 * - Clear IndexedDB and create the same three files through the UI.
 * - Set the mode in localStorage before reload to prevent the welcome screen flash.
 * The e2e tests also use this mode setup.
 */
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DIR = join(ROOT, 'docs', 'screenshots');
const VITE_BIN = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const PREVIEW_PORT = 4173;
const BASE_URL = `http://localhost:${PREVIEW_PORT}`;

const VIEWPORT = { width: 1280, height: 800 };
const DEVICE_SCALE_FACTOR = 2;

// Inject this stylesheet after each seed to stop dynamic visual changes.
// Freeze the CodeMirror cursor, spinner toast, Tailwind transitions, and modal animate-fade-in.
const FREEZE_ANIMATIONS_CSS = `
	*, *::before, *::after {
		transition-duration: 0s !important;
		animation-duration: 0s !important;
		animation-iteration-count: 1 !important;
	}
	.cm-cursor, .cm-cursor-primary { animation: none !important; opacity: 1 !important; }
	.animate-fade-in, .animate-spin { animation: none !important; }
`;

/**
 * Wait for the preview server response, with a timeout.
 */
async function waitForServer(url, timeoutMs = 60_000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const res = await fetch(url);
			if (res.ok) return;
		} catch {
			// The server is not ready yet.
		}
		await delay(500);
	}
	throw new Error(`The server at ${url} did not start before the timeout`);
}

/**
 * Start Vite preview as a child process.
 */
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

/**
 * Clear IndexedDB and localStorage. Set the French locale required by selectors.
 * Set source mode so new files open in CodeMirror for repeatable insertText calls.
 */
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
		localStorage.setItem('mdsh:locale', 'fr');
		localStorage.setItem('mdsh:mode', 'source');
	});
	await page.reload();
	await page.waitForLoadState('networkidle');
}

/**
 * Rename the active file through the toolbar input, which exists when a file is active.
 * Fill the input, then blur it to confirm.
 * Enter also works, but can move focus into the source editor and disrupt subsequent actions.
 */
async function renameActive(page, newName) {
	const input = page.locator('input[aria-label^="Nom du fichier"]');
	await input.waitFor({ timeout: 5000 });
	await input.fill(newName);
	await input.press('Enter');
	// Wait for store updates and the 800 ms accent border flash to finish.
	await delay(900);
}

/**
 * Replace all content in the active CodeMirror source editor.
 * Select all, press Delete, then call insertText.
 */
async function writeContent(page, content) {
	await page.locator('button[data-mode="source"]').click();
	const editor = page.locator('.cm-content').first();
	await editor.waitFor({ timeout: 5000 });
	await editor.click();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.press('Delete');
	await page.keyboard.insertText(content);
	// Wait for the 400 ms save debounce before the next action.
	await delay(500);
}

/**
 * Create the first file through the Welcome button in `<main>`.
 */
async function createFirstFile(page, name, content) {
	const welcomeBtn = page.locator('main').getByRole('button', { name: /Nouveau fichier/ });
	await welcomeBtn.waitFor({ timeout: 5000 });
	await welcomeBtn.click();
	await renameActive(page, name);
	await writeContent(page, content);
}

/**
 * Create another file through the sidebar.
 * The click activates the new empty file, ready for input.
 */
async function createSubsequentFile(page, name, content) {
	// The sidebar aria-label includes the localized shortcut. Match its stable prefix.
	const sidebarNewBtn = page.locator('aside button[aria-label^="Nouveau fichier"]').first();
	await sidebarNewBtn.click();
	await renameActive(page, name);
	await writeContent(page, content);
}

// Use the same three wiki-linked files to show Sidebar backlinks.

// Omit front matter from the main file. Milkdown shows YAML as plain text, which would distract in the screenshot.
// The Sidebar derives its title from H1 (see getFmTitle in frontmatter.ts).
const DEMO_WELCOME = `# Bienvenue dans mdsh

mdsh est un éditeur **markdown WYSIWYG** dark-mode-first, 100 % offline.

Voir aussi : [[diagrammes]] · [[idées]]

## Math KaTeX

Identité d'Euler : $e^{i\\pi} + 1 = 0$

## Code

\`\`\`ts
function greet(name: string) {
	return \`Hello, \${name}!\`;
}
\`\`\`

## Checklist

- [x] Markdown complet (GFM)
- [x] Math KaTeX
- [x] Diagrammes Mermaid
- [ ] Partage offline P2P
`;

const DEMO_DIAGRAMS = `---
title: Diagrammes
tags: [demo, mermaid]
---

# Diagrammes Mermaid

Référence : [[bienvenue]]

\`\`\`mermaid
graph LR
	A[Markdown] --> B{Mode}
	B -->|WYSIWYG| C[Milkdown]
	B -->|Source| D[CodeMirror]
	B -->|Lecture| E[Rendu HTML]
\`\`\`
`;

const DEMO_IDEAS = `---
title: Idées
tags: [demo, brainstorm]
---

# Idées

- Tester [[bienvenue]] en mode lecture
- Comparer avec [[diagrammes]]
- Exporter en PDF
`;

/**
 * Create three linked files. Create "idées" and "diagrammes" first; both link to "bienvenue".
 * Create "bienvenue" last so it stays active. Its Sidebar backlinks show the other two files.
 *
 * The Sidebar derives the "bienvenue" title from H1, with no YAML title (see DEMO_WELCOME).
 * Wait for the title to appear before capture. This confirms that displayTitle and metaCache have updated.
 */
async function seedDemoCorpus(page) {
	await createFirstFile(page, 'idées', DEMO_IDEAS);
	await createSubsequentFile(page, 'diagrammes', DEMO_DIAGRAMS);
	await createSubsequentFile(page, 'bienvenue', DEMO_WELCOME);
	await page.locator('aside button[aria-label^="bienvenue"]').waitFor({ timeout: 10_000 });
}

// Mode buttons use role="radio" in a radiogroup. Select them by their unique, stable data-mode.
const SCENARIOS = [
	{
		name: 'mode-wysiwyg.png',
		setup: async (page) => {
			await seedDemoCorpus(page);
			await page.locator('button[data-mode="wysiwyg"]').click();
			await page.waitForSelector('.milkdown', { timeout: 15_000 });
			// Wait for the initial Milkdown render, lazy chunk load, and ProseMirror mount.
			await delay(1200);
		}
	},
	{
		name: 'mode-source.png',
		setup: async (page) => {
			await seedDemoCorpus(page);
			// resetState already selected source mode. Make sure it has focus.
			await page.locator('.cm-content').first().click();
			await delay(300);
		}
	},
	{
		name: 'mode-read.png',
		setup: async (page) => {
			await seedDemoCorpus(page);
			await page.locator('button[data-mode="read"]').click();
			// Mermaid and KaTeX load on demand at first read. Wait for KaTeX to render.
			// Mermaid SVG can take longer, but does not block the screenshot.
			await page.waitForSelector('.mdsh-preview .katex', { timeout: 15_000 });
			await delay(800);
		}
	},
	{
		name: 'palette.png',
		setup: async (page) => {
			await seedDemoCorpus(page);
			await page.keyboard.press('ControlOrMeta+Shift+KeyP');
			await page.waitForSelector('[role="dialog"][aria-label="Palette de commandes"]', {
				timeout: 5000
			});
			await delay(200);
		}
	}
];

async function captureAll() {
	await mkdir(OUT_DIR, { recursive: true });
	const browser = await chromium.launch();
	const context = await browser.newContext({
		viewport: VIEWPORT,
		deviceScaleFactor: DEVICE_SCALE_FACTOR,
		colorScheme: 'dark'
	});
	const page = await context.newPage();

	for (const { name, setup } of SCENARIOS) {
		console.log(`[capture] ${name}`);
		await resetState(page);
		await setup(page);
		// Inject the freeze stylesheet after setup so it does not disrupt modal opening transitions, including the palette.
		await page.addStyleTag({ content: FREEZE_ANIMATIONS_CSS });
		await delay(100);
		await page.screenshot({ path: join(OUT_DIR, name), fullPage: false });
	}

	await context.close();
	await browser.close();
}

/**
 * Convert each PNG to WebP at quality 88, then remove the original PNG.
 * This saves about 65% of file size without a visible quality change in UI text, flat colors, and lines.
 * GitHub Markdown supports WebP. If cwebp is unavailable, log a message and keep the PNG files.
 */
async function convertToWebp() {
	const cwebpExists = spawnSync('which', ['cwebp']).status === 0;
	if (!cwebpExists) {
		console.warn(
			'[mdsh] cwebp is unavailable. Screenshots remain in PNG format. ' +
				'Install libwebp: `brew install webp` (macOS) or `apt install webp` (Debian).'
		);
		return;
	}
	for (const { name } of SCENARIOS) {
		const png = join(OUT_DIR, name);
		const webp = png.replace(/\.png$/, '.webp');
		const r = spawnSync('cwebp', ['-quiet', '-q', '88', '-m', '6', png, '-o', webp]);
		if (r.status !== 0) {
			console.warn(`[mdsh] cwebp failed for ${name}. The PNG is retained.`);
			continue;
		}
		await rm(png);
		console.log(`[convert] ${name.replace(/\.png$/, '.webp')}`);
	}
}

async function main() {
	console.log('[mdsh] starting the preview server...');
	const preview = startPreview();
	process.on('exit', () => preview.kill());
	process.on('SIGINT', () => {
		preview.kill();
		process.exit(130);
	});

	try {
		await waitForServer(BASE_URL);
		await captureAll();
		await convertToWebp();
		console.log(`[mdsh] screenshots written to ${OUT_DIR}`);
	} finally {
		preview.kill();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
