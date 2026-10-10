import { expect, test, type Page } from '@playwright/test';
import { createFirstFile, resetAppState, writeSourceContent } from './helpers';

const pixel = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64'
);

async function activeContent(page: Page): Promise<string> {
	return page.evaluate(
		() =>
			new Promise<string>((resolve, reject) => {
				const opening = indexedDB.open('mdsh');
				opening.onerror = () => reject(opening.error);
				opening.onsuccess = () => {
					const request = opening.result.transaction('drafts').objectStore('drafts').getAll();
					request.onerror = () => reject(request.error);
					request.onsuccess = () => resolve(request.result[0]?.content ?? '');
				};
			})
	);
}

async function seedActiveContent(page: Page, content: string): Promise<void> {
	await page.evaluate(
		(value) =>
			new Promise<void>((resolve, reject) => {
				const opening = indexedDB.open('mdsh');
				opening.onerror = () => reject(opening.error);
				opening.onsuccess = () => {
					const database = opening.result;
					const transaction = database.transaction('drafts', 'readwrite');
					const store = transaction.objectStore('drafts');
					const request = store.getAll();
					request.onerror = () => reject(request.error);
					request.onsuccess = () => {
						const row = request.result[0];
						store.put({ ...row, content: value, updatedAt: Date.now() });
					};
					transaction.oncomplete = () => resolve();
					transaction.onerror = () => reject(transaction.error);
				};
			}),
		content
	);
	await page.reload();
	await page.locator('.mdsh-shell[aria-busy="false"]:not([inert])').waitFor();
}

async function routePixel(page: Page) {
	await page.route(/\/risk-[^/]+\.png$/, (route) =>
		route.fulfill({ status: 200, contentType: 'image/png', body: pixel })
	);
}

test.beforeEach(async ({ page }) => {
	await resetAppState(page);
	await createFirstFile(page);
});

test('bounds automatic highlighting for a large code block', async ({ page }, info) => {
	test.setTimeout(45_000);
	const code = 'identifier += anotherIdentifier;\n'.repeat(20_000);
	await seedActiveContent(page, `# Large code\n\n\`\`\`\n${code}\`\`\``);
	await page.locator('[data-mode=read]').click();
	const prompt = page.getByRole('dialog', { name: 'Afficher ce document volumineux ?' });
	await expect(prompt).toBeVisible();
	await prompt.getByRole('button', { name: 'Afficher le document', exact: true }).click();
	const rendered = page.locator('code[data-mdsh-highlight="omitted"]');
	await expect(rendered).toBeVisible({ timeout: 5_000 });
	await expect(rendered).toContainText('identifier += anotherIdentifier;');
	await page.locator('[data-mode=source]').click();
	await expect(page.locator('.cm-content')).toBeVisible({ timeout: 2_000 });
	await info.attach('bounded-highlight.png', {
		body: await page.screenshot(),
		contentType: 'image/png'
	});
});

test('embeds a live image and preserves quoted and list fence examples', async ({ page }) => {
	await routePixel(page);
	const source = [
		'![Live](/risk-live.png)',
		'',
		'> ```md',
		'> ![Quoted](/risk-quoted.png)',
		'> ```',
		'',
		'- ```md',
		'  ![Listed](/risk-listed.png)',
		'  ```'
	].join('\n');
	await writeSourceContent(page, source);
	await page.locator('[data-mode=read]').click();
	await page.getByRole('button', { name: 'Charger les images distantes' }).click();
	await expect.poll(() => activeContent(page)).toMatch(/^!\[Live\]\(data:image\/png;base64,/);
	const content = await activeContent(page);
	expect(content).toContain('> ![Quoted](/risk-quoted.png)');
	expect(content).toContain('  ![Listed](/risk-listed.png)');
});

test('embeds a reference-style image after explicit consent', async ({ page }) => {
	await routePixel(page);
	await writeSourceContent(
		page,
		'# Reference image\n\n![Remote][pixel]\n\n[pixel]: /risk-reference.png "Pixel"'
	);
	await page.locator('[data-mode=read]').click();
	await page.getByRole('button', { name: 'Charger les images distantes' }).click();
	await expect
		.poll(() => activeContent(page))
		.toMatch(/\[pixel\]: data:image\/png;base64,[A-Za-z0-9+/=]+ "Pixel"/);
	await expect(page.locator('.mdsh-preview img')).toBeVisible();
});
