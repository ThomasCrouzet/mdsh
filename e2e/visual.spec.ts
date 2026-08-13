import { test, expect } from '@playwright/test';
import { resetAppState, createFirstFile, openPalette } from './helpers';

const FIXTURE = `# Titre H1

## Sous-titre H2

Paragraphe avec **gras**, *italique*, \`code inline\` et un [lien](https://example.com).

- Liste item 1
- Liste item 2
  - Imbriqué
- Liste item 3

1. Ordonné un
2. Ordonné deux

> Citation blockquote

\`\`\`js
const x = 42;
function hello() { return x; }
\`\`\`

| Col A | Col B |
| --- | --- |
| 1 | 2 |
| 3 | 4 |

---

- [ ] Tâche à faire
- [x] Tâche faite
`;

/**
 * Snapshots visuels des 3 modes (source, read) + palette.
 * Les snapshots attendus sont versionnés ; si le rendu dévie (typo, couleurs,
 * bordures), le test échoue et Playwright produit un diff PNG lisible.
 *
 * Génération/mise à jour : `npm run test:e2e -- --update-snapshots`
 * Les snapshots sont par plateforme (`-chromium-darwin.png`, `-chromium-linux.png`).
 * Le CI Linux doit générer les siens la première fois via un run avec
 * `--update-snapshots` puis les committer.
 */
test.describe('Snapshots visuels - 3 modes', () => {
	test.beforeEach(async ({ page }) => {
		await resetAppState(page, { mode: 'source' });
		await createFirstFile(page);

		// Injecter le contenu fixture dans CodeMirror (mode source)
		// La restauration asynchrone du dernier mode peut gagner la course au boot :
		// on sélectionne donc explicitement la source comme le ferait l'utilisateur.
		await page.locator('button[data-mode="source"]').click();
		const cm = page.locator('.cm-content').first();
		await expect(cm).toBeVisible({ timeout: 10_000 });
		await cm.click();
		// `keyboard.type` est plus fidèle à un usage réel et déclenche les
		// updateListeners CodeMirror correctement (vs. innerText assignement).
		await page.keyboard.type(FIXTURE);
		await page.waitForTimeout(500); // debounce save
	});

	test('mode source', async ({ page }) => {
		// Déjà en mode source via resetAppState
		await expect(page.locator('main')).toHaveScreenshot('source-mode.png', {
			maxDiffPixelRatio: 0.02
		});
	});

	test('mode lecture', async ({ page }) => {
		// Le bouton est `role="radio"` dans un radiogroup ; on cible via `data-mode`.
		await page.locator('button[data-mode="read"]').click();
		await expect(page.locator('.mdsh-preview')).toBeVisible();
		// Attendre que KaTeX/hljs/Mermaid (lazy) soient hydratés
		await page.waitForTimeout(800);
		await expect(page.locator('main')).toHaveScreenshot('read-mode.png', {
			maxDiffPixelRatio: 0.02
		});
	});

	test('palette de commandes', async ({ page }) => {
		await openPalette(page);
		const dialog = page.getByRole('dialog', { name: 'Palette de commandes' });
		await expect(dialog).toBeVisible();
		// Screenshot du dialog seul (plus stable que fullPage)
		await expect(dialog).toHaveScreenshot('palette.png', {
			maxDiffPixelRatio: 0.02
		});
	});
});
