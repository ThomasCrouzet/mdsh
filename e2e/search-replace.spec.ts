import { test, expect } from '@playwright/test';
import { resetAppState, createFirstFile } from './helpers';

test.describe('§5.13 - Search & replace in-file (⌘F)', () => {
	test.beforeEach(async ({ page }) => {
		// `resetAppState` force par défaut le mode source : CodeMirror est
		// donc visible dès le début, pas de bascule WYSIWYG → source à gérer.
		await resetAppState(page);
		await createFirstFile(page);
	});

	test('⌘F ouvre le panel CodeMirror et matche un motif', async ({ page }) => {
		// Garantit explicitement le mode source par un clic idempotent, au lieu de
		// dépendre de la restauration asynchrone de `mdsh:mode` au reload : sous
		// charge CI, l'app peut rester en WYSIWYG (Milkdown) → `.cm-content`
		// n'apparaît JAMAIS et le test timeout (vraie cause de la flakiness, pas
		// la lenteur). Même pattern robuste que helpers.writeSourceContent.
		const sourceBtn = page.locator('button[data-mode="source"]');
		if (await sourceBtn.count()) await sourceBtn.click();
		const cm = page.locator('.cm-content').first();
		await expect(cm).toBeVisible({ timeout: 15_000 });

		// Tape un contenu avec deux occurrences de "foo"
		await cm.click();
		await page.keyboard.type('# Hello');
		await page.keyboard.press('Enter');
		await page.keyboard.press('Enter');
		await page.keyboard.type('foo bar foo baz');

		// Debounce save (400 ms) + marge - pas critique pour ce test mais
		// évite les courses avec d'autres effets.
		await page.waitForTimeout(500);

		// Détermine le modificateur en fonction de la plateforme (Meta sur
		// macOS, Control ailleurs).
		const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
		await page.keyboard.press(`${mod}+f`);

		// Le panel CodeMirror s'affiche dans `.cm-panels` (rendu en bas par
		// défaut avec `top: false`). L'input principal a `name="search"`.
		const panel = page.locator('.cm-panels');
		await expect(panel).toBeVisible({ timeout: 5000 });

		const searchInput = panel.locator('input[name="search"]');
		await expect(searchInput).toBeVisible();
		// Tape via le clavier (l'input est focused à l'ouverture) plutôt que
		// `fill()` - fill remplace la value sans déclencher tous les
		// handlers CM, et la query peut ne pas se propager.
		await page.keyboard.type('foo');

		// Les matches sont stylés en `.cm-searchMatch` (Decoration.mark).
		await expect(page.locator('.cm-searchMatch')).toHaveCount(2, { timeout: 5000 });

		// Esc ferme le panel
		await page.keyboard.press('Escape');
		await expect(panel).toHaveCount(0, { timeout: 5000 });
	});

	test('⌘F en mode WYSIWYG bascule en mode source et ouvre le panel', async ({ page }) => {
		// Bascule en WYSIWYG via le radio toolbar (sémantique radiogroup) -
		// déterministe et évite les conflits keyboard.
		await page.getByRole('radio', { name: 'Mode WYSIWYG' }).click();
		// Milkdown lazy-load - attendre que ProseMirror soit monté.
		await expect(page.locator('.milkdown, .ProseMirror').first()).toBeVisible({
			timeout: 15_000
		});

		const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
		await page.keyboard.press(`${mod}+f`);

		// La bascule doit nous ramener en mode source (CodeMirror visible)
		// et le panel search doit être ouvert dans la foulée.
		await expect(page.locator('.cm-content').first()).toBeVisible({ timeout: 10_000 });
		await expect(page.locator('.cm-panels')).toBeVisible({ timeout: 5000 });
		await expect(page.locator('.cm-panels input[name="search"]')).toBeFocused({
			timeout: 5000
		});
	});
});
