import { test, expect } from '@playwright/test';
import { createFirstFile, resetAppState, writeSourceContent } from './helpers';

test('remote content stays offline until image consent', async ({ page }) => {
	const requested: string[] = [];
	await page.route('https://tracker.example/**', async (route) => {
		requested.push(route.request().url());
		await route.fulfill({
			status: 200,
			contentType: 'image/png',
			body: Buffer.from(
				'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
				'base64'
			)
		});
	});

	await resetAppState(page);
	await createFirstFile(page);
	await writeSourceContent(
		page,
		`# Private document

<img alt="Remote pixel" src="https://tracker.example/image.png">

<div style="background-image:url(\\68 ttps://tracker.example/css.png)">CSS payload</div>

<div style='background-image:image-set("https://tracker.example/image-set.png" 1x)'>Image set payload</div>`
	);
	await page.locator('button[data-mode="read"]').click();

	await expect(page.getByText('Les images distantes sont bloquées')).toBeVisible();
	await expect(page.locator('.mdsh-preview img')).not.toHaveAttribute('src');
	await page.waitForTimeout(500);
	expect(requested).toEqual([]);

	await page.getByRole('button', { name: 'Charger les images distantes' }).click();
	await expect.poll(() => requested.filter((url) => url.endsWith('/image.png')).length).toBe(1);
	expect(requested.some((url) => url.endsWith('/css.png'))).toBe(false);
	expect(requested.some((url) => url.endsWith('/image-set.png'))).toBe(false);
});
