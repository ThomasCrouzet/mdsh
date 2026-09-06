import { test, expect } from '@playwright/test';
import { resetAppState, seedFiles } from './helpers';

// Smallest valid transparent 1x1 PNG in base64, 67 bytes.
const TINY_PNG_BASE64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

test.describe('Drag and drop for local images - Batch 5', () => {
	test.beforeEach(async ({ page }) => {
		await resetAppState(page);
	});

	test('adds a `data:image` URI to the active file after a PNG drop', async ({ page }) => {
		await seedFiles(page, [{ name: 'demo', content: '# Demo\n' }]);

		// Simulate an operating system drop. Create a File from the base64 PNG, add it
		// to a DataTransfer, and dispatch dragover and drop events on window.
		// Adding the File with `items.add()` sets the marker that the store checks.
		await page.evaluate(async (b64) => {
			const bin = atob(b64);
			const arr = new Uint8Array(bin.length);
			for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
			const file = new File([arr], 'tiny.png', { type: 'image/png' });
			const dt = new DataTransfer();
			dt.items.add(file);
			const drop = new DragEvent('drop', {
				bubbles: true,
				cancelable: true,
				dataTransfer: dt
			});
			window.dispatchEvent(drop);
		}, TINY_PNG_BASE64);

		// The active file contains the appended image. resetAppState makes it visible
		// in CodeMirror source mode.
		const cm = page.locator('.cm-content').first();
		await expect(cm).toContainText('data:image/png;base64', { timeout: 5000 });
		await expect(cm).toContainText('![tiny]');
	});
});
