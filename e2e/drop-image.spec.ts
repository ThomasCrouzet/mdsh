import { test, expect } from '@playwright/test';
import { resetAppState, seedFiles } from './helpers';

// PNG 1×1 transparent en base64 (smallest valid PNG, 67 bytes).
const TINY_PNG_BASE64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

test.describe('Drag & drop d’images locales - Lot 5', () => {
	test.beforeEach(async ({ page }) => {
		await resetAppState(page);
	});

	test('drop d’une image PNG injecte une `data:image` dans le fichier actif', async ({ page }) => {
		await seedFiles(page, [{ name: 'demo', content: '# Demo\n' }]);

		// Simule un drop OS : construit un File depuis une PNG base64, l'attache
		// à un DataTransfer, dispatch les events dragover + drop sur window.
		// Le store filtre via `dataTransfer.types.includes('Files')`. Notre
		// DataTransfer programmatique pose bien le marqueur dès qu'on ajoute
		// un File via `items.add()` (vérifié sur Chromium ≥ 119).
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

		// L'image a été appendée au contenu du fichier actif : on le voit
		// dans CodeMirror (mode source forcé par resetAppState).
		const cm = page.locator('.cm-content').first();
		await expect(cm).toContainText('data:image/png;base64', { timeout: 5000 });
		await expect(cm).toContainText('![tiny]');
	});
});
