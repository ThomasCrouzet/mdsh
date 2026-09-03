import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	createFirstFile,
	openPalette,
	resetAppState,
	switchToSource,
	writeSourceContent
} from './helpers';

const imagePath = resolve('static/pwa-192x192.png');

async function visualEditor(page: Page) {
	await page.locator('button[data-mode="wysiwyg"]').click();
	await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 20_000 });
}

async function expectDecodedImage(page: Page, selector: string, count = 1) {
	await expect
		.poll(() =>
			page.locator(selector).evaluateAll((images) =>
				images.map((node) => {
					const image = node as HTMLImageElement;
					return [image.naturalWidth, image.naturalHeight];
				})
			)
		)
		.toEqual(Array.from({ length: count }, () => [192, 192]));
}

async function capturePrint(page: Page) {
	let captured = '';
	await page.exposeFunction('captureMediaPrint', (html: string) => {
		captured = html;
	});
	await page.evaluate(() => {
		const capture = (
			globalThis as typeof globalThis & { captureMediaPrint: (html: string) => Promise<void> }
		).captureMediaPrint;
		const observer = new MutationObserver((records) => {
			for (const record of records)
				for (const node of record.addedNodes) {
					if (!(node instanceof HTMLIFrameElement) || !node.contentWindow) continue;
					node.contentWindow.print = () => {
						void capture(node.contentDocument?.documentElement.outerHTML ?? '');
					};
				}
		});
		observer.observe(document.body, { childList: true, subtree: true });
	});
	return () => captured;
}

test.describe('Images durables et export PDF', () => {
	test.beforeEach(async ({ page }) => {
		await resetAppState(page, { mode: 'wysiwyg' });
		await createFirstFile(page);
		await visualEditor(page);
	});

	test('upload réel, pixels, rechargement et image 192x192 dans le PDF', async ({
		page,
		browser
	}, testInfo) => {
		await page.locator('.ProseMirror').click();
		await page.keyboard.insertText('/');
		await page.locator('.milkdown-slash-menu').getByText('Image', { exact: true }).click();
		const uploadChooser = page.waitForEvent('filechooser');
		await page
			.locator('.milkdown-image-block')
			.getByText('Importer une image', { exact: true })
			.click();
		await (await uploadChooser).setFiles(imagePath);
		await expectDecodedImage(page, '.milkdown-image-block img');
		await expect(page.locator('.milkdown-image-block img')).toHaveAttribute('alt', 'pwa-192x192');

		const original = (await readFile(imagePath)).toString('base64');
		const pixelsEqual = await page
			.locator('.milkdown-image-block img')
			.evaluate(async (node, base64) => {
				const expected = new Image();
				expected.src = `data:image/png;base64,${base64}`;
				await expected.decode();
				const pixels = (image: HTMLImageElement) => {
					const canvas = document.createElement('canvas');
					canvas.width = image.naturalWidth;
					canvas.height = image.naturalHeight;
					const context = canvas.getContext('2d');
					if (!context) throw new Error('Canvas indisponible');
					context.drawImage(image, 0, 0);
					return canvas.toDataURL();
				};
				return pixels(node as HTMLImageElement) === pixels(expected);
			}, original);
		expect(pixelsEqual).toBe(true);
		await switchToSource(page);
		await expect(page.locator('.cm-content')).toContainText(
			'![pwa-192x192](data:image/png;base64,'
		);
		await expect(page.locator('.cm-content')).not.toContainText('blob:');
		await page.waitForTimeout(700);
		await page.reload();
		await visualEditor(page);
		await expectDecodedImage(page, '.milkdown-image-block img');
		await page.locator('button[data-mode="read"]').click();
		await expectDecodedImage(page, '.mdsh-preview img');

		const captured = await capturePrint(page);
		await page.getByRole('button', { name: 'Exporter en PDF' }).click();
		await expect.poll(() => captured().length).toBeGreaterThan(100);
		expect(captured()).toContain('alt="pwa-192x192"');
		expect(captured()).toContain('src="data:image/png;base64,');
		const printable = await browser.newPage();
		await printable.goto(page.url());
		await printable.setContent(captured(), { waitUntil: 'networkidle' });
		await expectDecodedImage(printable, 'img');
		const pdfPath = testInfo.outputPath('uploaded-image.pdf');
		await printable.pdf({ path: pdfPath, format: 'A4', printBackground: true });
		await printable.close();
		const pdf = (await readFile(pdfPath)).toString('latin1');
		const images = pdf.match(/<<[^>]*\/Subtype\s*\/Image[^>]*>>/g) ?? [];
		expect(
			images.some(
				(dictionary) => /\/Width\s+192\b/.test(dictionary) && /\/Height\s+192\b/.test(dictionary)
			)
		).toBe(true);
		await testInfo.attach('uploaded-image-pdf', { path: pdfPath, contentType: 'application/pdf' });
	});

	test('collage et drop produisent des images visibles puis persistées', async ({ page }) => {
		const base64 = (await readFile(imagePath)).toString('base64');
		await page.locator('.ProseMirror').click();
		await page.evaluate((encoded) => {
			const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
			const transfer = new DataTransfer();
			transfer.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
			document
				.querySelector('.ProseMirror')
				?.dispatchEvent(
					new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer })
				);
		}, base64);
		await expectDecodedImage(page, '.milkdown-image-block img');
		await page.evaluate((encoded) => {
			const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
			const transfer = new DataTransfer();
			transfer.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }));
			window.dispatchEvent(
				new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
			);
		}, base64);
		await expectDecodedImage(page, '.milkdown-image-block img', 2);
		await switchToSource(page);
		await expect(page.locator('.cm-content')).toContainText('![pasted](data:image/png;base64,');
		await expect(page.locator('.cm-content')).toContainText('![dropped](data:image/png;base64,');
		await page.waitForTimeout(700);
		await page.reload();
		await visualEditor(page);
		await expectDecodedImage(page, '.milkdown-image-block img', 2);
	});

	test('aucune requête avant consentement puis incorporation réutilisée par tous les modes', async ({
		page
	}) => {
		let requests = 0;
		await page.route('https://media-test.invalid/figure.png', async (route) => {
			requests++;
			await route.fulfill({
				path: imagePath,
				contentType: 'image/png',
				headers: { 'access-control-allow-origin': '*' }
			});
		});
		await writeSourceContent(
			page,
			'![Figure distante](https://media-test.invalid/figure.png)\n\n<svg><filter id="f"><feImage href="https://media-test.invalid/figure.png"/></filter></svg>'
		);
		await visualEditor(page);
		await page.waitForTimeout(300);
		expect(requests).toBe(0);
		await page.locator('button[data-mode="read"]').click();
		await expect(page.getByRole('button', { name: 'Charger les images distantes' })).toBeVisible();
		expect(requests).toBe(0);
		await page.getByRole('button', { name: 'Charger les images distantes' }).click();
		await expectDecodedImage(page, '.mdsh-preview img');
		expect(requests).toBe(1);
		await visualEditor(page);
		await expectDecodedImage(page, '.milkdown-image-block img');
		expect(requests).toBe(1);
	});

	test('incorpore une image voisine sélectionnée explicitement', async ({ page }) => {
		await writeSourceContent(page, '![Figure locale](<images/figure été.png> "Légende")');
		await page.locator('button[data-mode="read"]').click();
		const fileChooser = page.waitForEvent('filechooser');
		await page.getByRole('button', { name: 'Sélectionner les images', exact: true }).click();
		await (
			await fileChooser
		).setFiles({
			name: 'figure été.png',
			mimeType: 'image/png',
			buffer: await readFile(imagePath)
		});
		await expectDecodedImage(page, '.mdsh-preview img');
		await expect(page.locator('.mdsh-preview img')).toHaveAttribute('alt', 'Figure locale');
		await expect(page.locator('.mdsh-preview img')).toHaveAttribute('title', 'Légende');
		await switchToSource(page);
		await expect(page.locator('.cm-content')).toContainText('data:image/png;base64,');
	});

	test('le HTML téléchargé conserve une data URI et une image relative incorporée hors ligne', async ({
		page,
		browser
	}, testInfo) => {
		const bytes = await readFile(imagePath);
		const base64 = bytes.toString('base64');
		await writeSourceContent(
			page,
			`![Image incorporée](DATA:image/png;charset=UTF-8;base64,${base64})\n\n![Figure locale](<images/figure été.png> "Légende")`
		);
		await page.locator('button[data-mode="read"]').click();
		const chooser = page.waitForEvent('filechooser');
		await page.getByRole('button', { name: 'Sélectionner les images', exact: true }).click();
		await (
			await chooser
		).setFiles({ name: 'figure été.png', mimeType: 'image/png', buffer: bytes });
		await expectDecodedImage(page, '.mdsh-preview img', 2);
		await openPalette(page);
		await page.keyboard.type('Exporter en HTML');
		const downloading = page.waitForEvent('download');
		await page.keyboard.press('Enter');
		const download = await downloading;
		const output = testInfo.outputPath('images-offline.html');
		await download.saveAs(output);
		const html = await readFile(output, 'utf8');
		expect(html).not.toContain('images/figure été.png');
		const context = await browser.newContext({ offline: true });
		try {
			const offline = await context.newPage();
			const networkRequests: string[] = [];
			offline.on('request', (request) => {
				if (/^https?:/i.test(request.url())) networkRequests.push(request.url());
			});
			await offline.goto(pathToFileURL(output).href);
			await expectDecodedImage(offline, 'img', 2);
			await expect(offline.locator('img').first()).toHaveAttribute('alt', 'Image incorporée');
			await expect(offline.locator('img').last()).toHaveAttribute('alt', 'Figure locale');
			await expect(offline.locator('img').last()).toHaveAttribute('title', 'Légende');
			expect(
				await offline
					.locator('img')
					.evaluateAll((images) => images.map((image) => image.getAttribute('src')))
			).toEqual([`data:image/png;base64,${base64}`, `data:image/png;base64,${base64}`]);
			expect(networkRequests).toEqual([]);
		} finally {
			await context.close();
		}
		await testInfo.attach('images-html', { path: output, contentType: 'text/html' });
	});
});
