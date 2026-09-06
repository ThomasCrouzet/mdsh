import { test, expect } from '@playwright/test';
import { resetAppState, createFirstFile } from './helpers';

test.describe('§5.13 - Search & replace in-file (⌘F)', () => {
	test.beforeEach(async ({ page }) => {
		// `resetAppState` selects source mode by default, so CodeMirror is visible.
		await resetAppState(page);
		await createFirstFile(page);
	});

	test('opens the CodeMirror search panel and matches a pattern with ⌘F', async ({ page }) => {
		// Select source mode with an idempotent click. Do not depend on async mode
		// restoration after reload. Under CI load, the app can stay in WYSIWYG mode
		// and never show `.cm-content`.
		const sourceBtn = page.locator('button[data-mode="source"]');
		if (await sourceBtn.count()) await sourceBtn.click();
		const cm = page.locator('.cm-content').first();
		await expect(cm).toBeVisible({ timeout: 15_000 });

		// Enter content with two occurrences of "foo".
		await cm.click();
		await page.keyboard.type('# Hello');
		await page.keyboard.press('Enter');
		await page.keyboard.press('Enter');
		await page.keyboard.type('foo bar foo baz');

		// Wait for the 400 ms save delay and a margin to prevent effect races.
		await page.waitForTimeout(500);

		// Use Meta on macOS and Control on other platforms.
		const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
		await page.keyboard.press(`${mod}+f`);

		// CodeMirror renders the panel in `.cm-panels` at the bottom by default.
		// The main input has `name="search"`.
		const panel = page.locator('.cm-panels');
		await expect(panel).toBeVisible({ timeout: 5000 });

		const searchInput = panel.locator('input[name="search"]');
		await expect(searchInput).toBeVisible();
		// Type with the keyboard because the input has focus. `fill()` does not call
		// all CodeMirror handlers and can fail to apply the query.
		await page.keyboard.type('foo');

		// CodeMirror marks matches with `.cm-searchMatch`.
		await expect(page.locator('.cm-searchMatch')).toHaveCount(2, { timeout: 5000 });

		// Escape closes the panel.
		await page.keyboard.press('Escape');
		await expect(panel).toHaveCount(0, { timeout: 5000 });
	});

	test('changes from WYSIWYG to source mode and opens search with ⌘F', async ({ page }) => {
		// Select WYSIWYG from the toolbar radio group.
		await page.getByRole('radio', { name: 'Mode WYSIWYG' }).click();
		// Wait for the lazy Milkdown module to mount ProseMirror.
		await expect(page.locator('.milkdown, .ProseMirror').first()).toBeVisible({
			timeout: 15_000
		});

		const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
		await page.keyboard.press(`${mod}+f`);

		// The shortcut must show CodeMirror in source mode and open its search panel.
		await expect(page.locator('.cm-content').first()).toBeVisible({ timeout: 10_000 });
		await expect(page.locator('.cm-panels')).toBeVisible({ timeout: 5000 });
		await expect(page.locator('.cm-panels input[name="search"]')).toBeFocused({
			timeout: 5000
		});
	});
});
