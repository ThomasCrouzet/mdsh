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
 * Visual snapshots for the source mode, read mode, and command palette.
 * The expected snapshots are versioned. If the rendering changes, the test fails
 * and Playwright creates a readable PNG diff.
 *
 * Generate or update: `npm run test:e2e -- --update-snapshots`
 * Snapshots are platform-specific (`-chromium-darwin.png`, `-chromium-linux.png`).
 * Linux CI must create its snapshots with `--update-snapshots` on the first run.
 * Then, commit the snapshots.
 */
test.describe('Snapshots visuels - 3 modes', () => {
	test.beforeEach(async ({ page }) => {
		await resetAppState(page, { mode: 'source' });
		await createFirstFile(page);

		// Insert the fixture content into CodeMirror in source mode.
		// Async mode restoration can finish after startup. Select source mode explicitly.
		await page.locator('button[data-mode="source"]').click();
		const cm = page.locator('.cm-content').first();
		await expect(cm).toBeVisible({ timeout: 10_000 });
		await cm.click();
		// `keyboard.type` simulates user input and calls the CodeMirror update listeners.
		await page.keyboard.type(FIXTURE);
		await page.waitForTimeout(500); // debounce save
	});

	test('mode source', async ({ page }) => {
		// resetAppState already selected source mode.
		await expect(page.locator('main')).toHaveScreenshot('source-mode.png', {
			maxDiffPixelRatio: 0.02
		});
	});

	test('mode lecture', async ({ page }) => {
		// The button has `role="radio"`. Select it with `data-mode`.
		await page.locator('button[data-mode="read"]').click();
		await expect(page.locator('.mdsh-preview')).toBeVisible();
		// Wait for the lazy KaTeX, highlight.js, and Mermaid modules.
		await page.waitForTimeout(800);
		await expect(page.locator('main')).toHaveScreenshot('read-mode.png', {
			maxDiffPixelRatio: 0.02
		});
	});

	test('palette de commandes', async ({ page }) => {
		await openPalette(page);
		const dialog = page.getByRole('dialog', { name: 'Palette de commandes' });
		await expect(dialog).toBeVisible();
		// Capture only the dialog for a stable snapshot.
		await expect(dialog).toHaveScreenshot('palette.png', {
			maxDiffPixelRatio: 0.02
		});
	});
});
