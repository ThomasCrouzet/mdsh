import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resetAppState, seedFiles, openPalette } from './helpers';

async function expectMermaidLabels(page: Page, selector: string) {
	const diagram = page.locator(selector).first();
	await expect(diagram).toBeVisible({ timeout: 20_000 });
	await expect
		.poll(() =>
			diagram.locator('.node').evaluateAll((nodes) =>
				nodes.map((node) => {
					const text = node.querySelector('text');
					const shape = node.querySelector('rect');
					const box = text?.getBBox();
					return {
						label: text?.textContent?.trim(),
						visible: Boolean(box && box.width > 0 && box.height > 0),
						fill: shape ? getComputedStyle(shape).fill : ''
					};
				})
			)
		)
		.toEqual([
			{ label: 'A', visible: true, fill: expect.not.stringMatching(/^(?:rgb\(0, 0, 0\)|none|)$/) },
			{ label: 'B', visible: true, fill: 'rgb(254, 226, 226)' }
		]);
	await expect(diagram.locator('style, foreignObject')).toHaveCount(0);
}

test.describe('Rendu KaTeX + Mermaid en mode lecture', () => {
	test.beforeEach(async ({ page }) => {
		await resetAppState(page);
	});

	test('KaTeX rendu en mode lecture', async ({ page }) => {
		await seedFiles(page, [
			{
				name: 'math',
				content: '# Math\n\nIdentité d’Euler : $e^{i\\pi} + 1 = 0$\n'
			}
		]);
		await page.locator('button[data-mode="read"]').click();
		// `.katex` est posé par le rendu KaTeX une fois le module lazy chargé.
		await expect(page.locator('.mdsh-preview .katex').first()).toBeVisible({
			timeout: 15_000
		});
	});

	test('Mermaid conserve ses labels et couleurs en lecture, HTML hors ligne et PDF', async ({
		page,
		browser
	}, testInfo) => {
		await seedFiles(page, [
			{
				name: 'diagram',
				content:
					'# Diagramme\n\n```mermaid\ngraph LR\nA --> B\nstyle B fill:#fee2e2,stroke:#991b1b,color:#123456\n```\n'
			}
		]);
		await page.locator('button[data-mode="read"]').click();
		await expectMermaidLabels(page, '.mdsh-preview svg');
		await page
			.locator('.mdsh-preview svg')
			.screenshot({ path: testInfo.outputPath('mermaid-read.png') });

		let captured = '';
		await page.exposeFunction('captureMermaidPrint', (html: string) => {
			captured = html;
		});
		await page.evaluate(() => {
			const capture = (
				globalThis as typeof globalThis & { captureMermaidPrint: (html: string) => Promise<void> }
			).captureMermaidPrint;
			new MutationObserver((records) => {
				for (const record of records)
					for (const node of record.addedNodes) {
						if (node instanceof HTMLIFrameElement && node.contentWindow)
							node.contentWindow.print = () => {
								void capture(node.contentDocument?.documentElement.outerHTML ?? '');
							};
					}
			}).observe(document.body, { childList: true, subtree: true });
		});
		await page.getByRole('button', { name: 'Exporter en PDF' }).click();
		await expect.poll(() => captured.length).toBeGreaterThan(100);
		const printable = await browser.newPage();
		await printable.goto(page.url());
		await printable.setContent(captured, { waitUntil: 'networkidle' });
		await printable.emulateMedia({ media: 'print' });
		await expectMermaidLabels(printable, '.mermaid-block svg');
		const pdfPath = testInfo.outputPath('mermaid.pdf');
		await printable.pdf({ path: pdfPath, format: 'A4', printBackground: true });
		expect((await readFile(pdfPath)).subarray(0, 5).toString()).toBe('%PDF-');
		await testInfo.attach('mermaid-pdf', { path: pdfPath, contentType: 'application/pdf' });
		await printable.close();

		await openPalette(page);
		await page.keyboard.type('Exporter en HTML');
		const download = page.waitForEvent('download');
		await page.keyboard.press('Enter');
		const htmlPath = testInfo.outputPath('mermaid.html');
		await (await download).saveAs(htmlPath);
		const offline = await browser.newContext({ offline: true });
		const exported = await offline.newPage();
		await exported.goto(pathToFileURL(htmlPath).href);
		await expectMermaidLabels(exported, '.mermaid-block svg');
		await testInfo.attach('mermaid-html', { path: htmlPath, contentType: 'text/html' });
		await offline.close();
	});

	test('Mermaid refuse les images et styles réseau avant toute requête', async ({ page }) => {
		const requests: string[] = [];
		await page.route('**/mermaid-beacon*', async (route) => {
			requests.push(route.request().url());
			await route.abort();
		});
		for (const [index, code] of [
			'flowchart TD\nA@{ "i\\u006dg": "/mermaid-beacon.png", label: "Image" }',
			'---\nconfig:\n  themeCSS: ".node rect {fill:url(/mermaid-beacon.svg#paint)}"\n---\nflowchart TD\nA --> B'
		].entries()) {
			if (index > 0) await resetAppState(page);
			await seedFiles(page, [
				{ name: `unsafe-diagram-${index}`, content: '```mermaid\n' + code + '\n```' }
			]);
			await page.locator('button[data-mode="read"]').click();
			await expect(page.locator('.mermaid-error')).toContainText(
				'Les images intégrées et les styles réseau Mermaid ne sont pas pris en charge'
			);
		}
		expect(requests).toEqual([]);
	});

	test('checklist sans puce superposée et permalien limité à la lecture', async ({ page }) => {
		await seedFiles(page, [
			{
				name: 'tasks',
				content: '## Tâches\n\n- [ ] À faire\n- [x] Fait\n'
			}
		]);
		await page.locator('button[data-mode="read"]').click();

		const taskItems = page.locator('.mdsh-preview li.task-list-item');
		await expect(taskItems).toHaveCount(2);
		await expect(taskItems.first()).toHaveCSS('list-style-type', 'none');
		await expect(page.locator('.mdsh-preview .mdsh-anchor')).toHaveCount(1);
	});
});
