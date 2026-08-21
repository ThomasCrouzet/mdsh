import { expect, test, type Page } from '@playwright/test';
import { createFirstFile, resetAppState } from './helpers';

async function durableContent(page: Page): Promise<string> {
	return page.evaluate(
		() =>
			new Promise<string>((resolve) => {
				const request = indexedDB.open('mdsh');
				request.onerror = () => resolve('');
				request.onsuccess = () => {
					const database = request.result;
					const cursor = database.transaction('drafts').objectStore('drafts').openCursor();
					cursor.onerror = () => {
						database.close();
						resolve('');
					};
					cursor.onsuccess = () => {
						const content =
							(cursor.result?.value as { content?: string } | undefined)?.content ?? '';
						database.close();
						resolve(content);
					};
				};
			})
	);
}

async function replaceEditorContent(page: Page, content: string): Promise<void> {
	await page.locator('button[data-mode="source"]').click();
	const editor = page.locator('.cm-content').first();
	await editor.click();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.insertText(content);
}

test('hidden and unload signals flush the current revision before debounce', async ({ page }) => {
	await resetAppState(page);
	await createFirstFile(page);

	for (const [content, signal] of [
		['hidden revision', 'visibilitychange'],
		['pagehide revision', 'pagehide'],
		['beforeunload revision', 'beforeunload']
	] as const) {
		await replaceEditorContent(page, content);
		await page.evaluate((eventName) => {
			if (eventName === 'visibilitychange') {
				Object.defineProperty(document, 'visibilityState', {
					configurable: true,
					value: 'hidden'
				});
				document.dispatchEvent(new Event(eventName));
				Object.defineProperty(document, 'visibilityState', {
					configurable: true,
					value: 'visible'
				});
			} else {
				window.dispatchEvent(new Event(eventName));
			}
		}, signal);
		await expect.poll(() => durableContent(page)).toBe(content);
	}
});
