import { expect, test, type Page } from '@playwright/test';
import { createFirstFile, resetAppState } from './helpers';

async function savedMarkdown(page: Page): Promise<string[]> {
	return page.evaluate(
		() =>
			new Promise<string[]>((resolve, reject) => {
				if (typeof indexedDB === 'undefined') {
					reject(new Error('IndexedDB is not available'));
					return;
				}
				const request = indexedDB.open('mdsh');
				request.onerror = () => reject(request.error);
				request.onsuccess = () => {
					const database = request.result;
					const transaction = database.transaction('drafts');
					const rows = transaction.objectStore('drafts').getAll();
					rows.onerror = () => reject(rows.error);
					rows.onsuccess = () =>
						resolve(rows.result.map((row: { content: string }) => row.content.trim()));
					transaction.oncomplete = () => database.close();
					transaction.onabort = () => {
						database.close();
						reject(transaction.error);
					};
				};
			})
	);
}

for (const language of [
	{ locale: 'fr', heading: 'Titre', quote: 'Citation' },
	{ locale: 'en', heading: 'Heading', quote: 'Quote' }
] as const) {
	test.describe(`Visual editor slash commands (${language.locale})`, () => {
		test.beforeEach(async ({ page }) => {
			await resetAppState(page, { mode: 'wysiwyg' });
			await createFirstFile(page);
			await page.locator('button[data-mode="wysiwyg"]').click();
			await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 20_000 });
			if (language.locale === 'en') {
				await page.keyboard.press('ControlOrMeta+,');
				await page
					.getByRole('group', { name: 'Langue' })
					.getByRole('button', { name: 'English' })
					.click();
				await page
					.getByRole('dialog', { name: 'Settings' })
					.getByRole('button', { name: 'Close', exact: true })
					.click();
			}
			await expect(page.locator('html')).toHaveAttribute('lang', language.locale);
		});

		for (const prefix of ['t', 'h']) {
			test(`selects /${prefix}1 through /${prefix}6 and saves headings without aliases`, async ({
				page
			}) => {
				const editor = page.locator('.ProseMirror');
				const menu = page.locator('.milkdown-slash-menu');
				const markdown: string[] = [];
				await editor.click();

				for (let level = 1; level <= 6; level++) {
					await test.step(`Select /${prefix}${level}`, async () => {
						if (level > 1) await page.keyboard.press('Enter');
						await page.keyboard.type(`/${prefix}${level}`);
						await expect(menu).toBeVisible();
						await expect(menu.locator('[data-index]')).toHaveCount(1);
						await expect(menu.locator('[data-index]')).toContainText(
							`${language.heading} ${level}`
						);
						await page.keyboard.press('Enter');
						await expect(menu).not.toBeVisible();
						await expect(editor.locator(`h${level}`)).toHaveText('');
						await page.keyboard.type(`Section ${level}`);
						await expect(editor.locator(`h${level}`)).toHaveText(`Section ${level}`);
						markdown.push(`${'#'.repeat(level)} Section ${level}`);
					});
				}

				// Check the saved draft after the normal save delay.
				await expect.poll(() => savedMarkdown(page)).toEqual([markdown.join('\n\n')]);
				await page.reload();
				await page.locator('button[data-mode="wysiwyg"]').click();
				for (let level = 1; level <= 6; level++) {
					await expect(editor.locator(`h${level}`)).toHaveText(`Section ${level}`);
				}
				await expect(editor).not.toContainText(`/${prefix}`);
			});
		}

		test('keeps localized heading searches and pointer selection', async ({ page }) => {
			const editor = page.locator('.ProseMirror');
			const menu = page.locator('.milkdown-slash-menu');
			await editor.click();
			await page.keyboard.type(`/${language.heading.toLowerCase()}`);
			await expect(menu).toBeVisible();
			await expect(menu.locator('[data-index]')).toHaveCount(6);
			await page.keyboard.type(' 3');
			await expect(menu.locator('[data-index]')).toHaveCount(1);
			await expect(menu.locator('[data-index]')).toContainText(`${language.heading} 3`);
			await menu.locator('[data-index]').click();
			await expect(editor.locator('h3')).toHaveText('');
			await page.keyboard.type('Localized heading');
			await expect(editor.locator('h3')).toHaveText('Localized heading');
			await expect.poll(() => savedMarkdown(page)).toEqual(['### Localized heading']);
		});

		test('keeps other localized slash commands', async ({ page }) => {
			const editor = page.locator('.ProseMirror');
			const menu = page.locator('.milkdown-slash-menu');
			await editor.click();
			await page.keyboard.type(`/${language.quote.toLowerCase()}`);
			await expect(menu).toBeVisible();
			await expect(menu.locator('[data-index]')).toHaveCount(1);
			await expect(menu.locator('[data-index]')).toHaveText(language.quote);
			await page.keyboard.press('Enter');
			await expect(editor.locator('blockquote')).toHaveText('');
			await page.keyboard.type('Quoted text');
			await expect(editor.locator('blockquote')).toHaveText('Quoted text');
			await expect.poll(() => savedMarkdown(page)).toEqual(['> Quoted text']);
		});

		test('lists each heading once and keeps cancelled aliases as text', async ({ page }) => {
			const editor = page.locator('.ProseMirror');
			const menu = page.locator('.milkdown-slash-menu');
			await editor.click();
			await page.keyboard.type('/');
			await expect(menu).toBeVisible();
			await expect(
				menu.locator('[data-index]').filter({ hasText: new RegExp(`${language.heading} [1-6]`) })
			).toHaveCount(6);
			await page.keyboard.type('t1');
			await expect(menu.locator('[data-index]')).toHaveCount(1);
			await page.keyboard.press('Escape');
			await expect(menu).not.toBeVisible();
			await expect(editor.locator('p')).toHaveText('/t1');
			await page.keyboard.type(' plain text');
			await expect(editor.locator('h1')).toHaveCount(0);
			await expect.poll(() => savedMarkdown(page)).toEqual(['/t1 plain text']);
		});
	});
}
