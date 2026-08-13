#!/usr/bin/env node
/**
 * Capture des screenshots du README via Playwright.
 *
 * Démarre le serveur de preview (build prod), navigue dans chaque scénario
 * et écrit les PNG dans docs/screenshots/.
 *
 * Pré-requis :
 *   npm run build
 *   (le serveur preview est lancé automatiquement ci-dessous)
 *
 * Usage :
 *   node scripts/capture-screenshots.mjs
 *
 * Idempotence des captures :
 *   - viewport fixe 1280×800, DPR 2 (PNG retina) ;
 *   - animations CSS désactivées (transitions, caret CodeMirror, spinner) ;
 *   - IndexedDB nettoyée puis seed déterministe de 3 fichiers via l'UI ;
 *   - mode forcé via `localStorage` avant le reload pour éviter le flash
 *     d'écran d'accueil avant le seed (utilisé par les tests E2E aussi).
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

// Stylesheet injectée après chaque seed pour figer les rendus dynamiques.
// On vise les animations qui font baver les diffs : caret CodeMirror,
// spinner toast, transitions Tailwind, animation `animate-fade-in` des modaux.
const FREEZE_ANIMATIONS_CSS = `
	*, *::before, *::after {
		transition-duration: 0s !important;
		animation-duration: 0s !important;
		animation-iteration-count: 1 !important;
	}
	.cm-cursor, .cm-cursor-primary { animation: none !important; opacity: 1 !important; }
	.animate-fade-in, .animate-spin { animation: none !important; }
`;

/** Attend que le serveur preview réponde (avec timeout). */
async function waitForServer(url, timeoutMs = 60_000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const res = await fetch(url);
			if (res.ok) return;
		} catch {
			// pas encore prêt
		}
		await delay(500);
	}
	throw new Error(`Le serveur ${url} n'a pas démarré dans les temps`);
}

/** Démarre Vite preview directement en sous-processus. */
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
 * Reset complet : IndexedDB + localStorage, puis force la locale française
 * utilisée par les sélecteurs et le mode source pour que les nouveaux fichiers
 * s'ouvrent dans CodeMirror (insertText déterministe).
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
 * Renomme le fichier actif via l'input toolbar (toujours présent dès qu'un
 * fichier est actif). On fill puis blur pour valider - le pattern "Enter"
 * fonctionne aussi mais peut envoyer le focus dans l'éditeur source juste
 * après, ce qui parasite l'enchaînement.
 */
async function renameActive(page, newName) {
	const input = page.locator('input[aria-label^="Nom du fichier"]');
	await input.waitFor({ timeout: 5000 });
	await input.fill(newName);
	await input.press('Enter');
	// Laisse le store propager + flash 800 ms de l'accent border disparaître.
	await delay(900);
}

/**
 * Écrit du contenu dans le mode source (CodeMirror) du fichier actif. On
 * remplace tout : sélection complète + Delete + insertText.
 */
async function writeContent(page, content) {
	await page.locator('button[data-mode="source"]').click();
	const editor = page.locator('.cm-content').first();
	await editor.waitFor({ timeout: 5000 });
	await editor.click();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.press('Delete');
	await page.keyboard.insertText(content);
	// Laisse le debounce save (400 ms) propager avant la prochaine action.
	await delay(500);
}

/** Crée le 1er fichier via le bouton Welcome (en `<main>`). */
async function createFirstFile(page, name, content) {
	const welcomeBtn = page.locator('main').getByRole('button', { name: /Nouveau fichier/ });
	await welcomeBtn.waitFor({ timeout: 5000 });
	await welcomeBtn.click();
	await renameActive(page, name);
	await writeContent(page, content);
}

/**
 * Crée un fichier supplémentaire via la sidebar (le clic active automatiquement
 * le nouveau fichier, l'éditeur source se vide → on peut écrire directement).
 */
async function createSubsequentFile(page, name, content) {
	// L'aria-label sidebar inclut le raccourci formatté : "Nouveau fichier, raccourci …".
	const sidebarNewBtn = page.locator('aside button[aria-label^="Nouveau fichier"]').first();
	await sidebarNewBtn.click();
	await renameActive(page, name);
	await writeContent(page, content);
}

// Contenu déterministe - trois fichiers liés via wiki-links pour exhiber
// la section backlinks de la Sidebar.

// Pas de front-matter sur le fichier principal : Milkdown WYSIWYG affiche
// le YAML comme texte brut (comportement attendu), ce qui pollue le screenshot.
// Le titre Sidebar est alors dérivé du H1 (cf. getFmTitle dans frontmatter.ts).
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
 * Seed canonique : 3 fichiers liés. On crée "idées" et "diagrammes" en premier
 * (ils linkent vers "bienvenue") ; "bienvenue" est créé en dernier et reste
 * donc actif → la section Backlinks de la Sidebar liste "idées" et
 * "diagrammes" dans le screenshot final.
 *
 * Le titre Sidebar de "bienvenue" est dérivé du H1 (pas de YAML title sur ce
 * fichier - cf. DEMO_WELCOME) ; on attend qu'il apparaisse pour valider que
 * la propagation displayTitle / metaCache a eu lieu avant le screenshot.
 */
async function seedDemoCorpus(page) {
	await createFirstFile(page, 'idées', DEMO_IDEAS);
	await createSubsequentFile(page, 'diagrammes', DEMO_DIAGRAMS);
	await createSubsequentFile(page, 'bienvenue', DEMO_WELCOME);
	await page.locator('aside button[aria-label^="bienvenue"]').waitFor({ timeout: 10_000 });
}

// Les boutons de mode sont des `role="radio"` dans un radiogroup - on cible
// via leur `data-mode` qui est unique et stable.
const SCENARIOS = [
	{
		name: 'mode-wysiwyg.png',
		setup: async (page) => {
			await seedDemoCorpus(page);
			await page.locator('button[data-mode="wysiwyg"]').click();
			await page.waitForSelector('.milkdown', { timeout: 15_000 });
			// Laisse Milkdown finir son rendu initial (lazy chunk + ProseMirror mount).
			await delay(1200);
		}
	},
	{
		name: 'mode-source.png',
		setup: async (page) => {
			await seedDemoCorpus(page);
			// Déjà en mode source via resetState, juste s'assurer du focus.
			await page.locator('.cm-content').first().click();
			await delay(300);
		}
	},
	{
		name: 'mode-read.png',
		setup: async (page) => {
			await seedDemoCorpus(page);
			await page.locator('button[data-mode="read"]').click();
			// Mermaid + KaTeX sont lazy-loadés à la première lecture ; attendre
			// au moins un signal (KaTeX rendu) - le SVG Mermaid peut prendre
			// plus longtemps mais ce n'est pas bloquant pour le screenshot.
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
		// Injecte la stylesheet de gel APRÈS le setup pour ne pas perturber
		// les transitions d'ouverture des modaux (palette).
		await page.addStyleTag({ content: FREEZE_ANIMATIONS_CSS });
		await delay(100);
		await page.screenshot({ path: join(OUT_DIR, name), fullPage: false });
	}

	await context.close();
	await browser.close();
}

/**
 * Convertit chaque PNG en WebP (quality 88) puis supprime le PNG d'origine.
 * Économise ~65 % de poids pour une qualité visuelle imperceptible sur les
 * captures de UI (texte, aplats, lignes nettes). GitHub markdown rend nativement
 * le WebP. Si `cwebp` n'est pas installé, on log et on garde les PNG.
 */
async function convertToWebp() {
	const cwebpExists = spawnSync('which', ['cwebp']).status === 0;
	if (!cwebpExists) {
		console.warn(
			'[mdsh] cwebp introuvable - captures laissées en PNG. ' +
				'Installer libwebp : `brew install webp` (macOS) ou `apt install webp` (Debian).'
		);
		return;
	}
	for (const { name } of SCENARIOS) {
		const png = join(OUT_DIR, name);
		const webp = png.replace(/\.png$/, '.webp');
		const r = spawnSync('cwebp', ['-quiet', '-q', '88', '-m', '6', png, '-o', webp]);
		if (r.status !== 0) {
			console.warn(`[mdsh] cwebp a échoué sur ${name}, PNG conservé.`);
			continue;
		}
		await rm(png);
		console.log(`[convert] ${name.replace(/\.png$/, '.webp')}`);
	}
}

async function main() {
	console.log('[mdsh] démarrage du serveur preview...');
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
		console.log(`[mdsh] captures écrites dans ${OUT_DIR}`);
	} finally {
		preview.kill();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
