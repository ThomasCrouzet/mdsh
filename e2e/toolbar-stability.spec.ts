import { expect, test } from '@playwright/test';
import { createFirstFile, resetAppState, writeSourceContent } from './helpers';

test('offline readiness keeps the mode button under the pointer', async ({ page }, info) => {
	await page.addInitScript(() => {
		const register = navigator.serviceWorker.register.bind(navigator.serviceWorker);
		navigator.serviceWorker.register = (...args) =>
			new Promise((resolve, reject) => {
				window.addEventListener(
					'release-offline-install',
					() => {
						void register(...args).then(resolve, reject);
					},
					{ once: true }
				);
				document.documentElement.dataset.offlineInstall = 'waiting';
			});
	});
	await resetAppState(page);
	await createFirstFile(page);
	await writeSourceContent(page, '# Stable toolbar\n\n- First item');
	await page.locator('button[data-mode="wysiwyg"]').click();
	await expect(page.locator('.ProseMirror')).toContainText('First item');
	await expect(page.locator('html')).toHaveAttribute('data-offline-install', 'waiting');
	const indicator = page.locator('.mdsh-local-indicator');
	await expect(indicator).toContainText('Préparation');
	const button = page.locator('button[data-mode="read"]');
	const before = await button.boundingBox();
	expect(before).not.toBeNull();
	const point = { x: before!.x + before!.width / 2, y: before!.y + before!.height / 2 };
	await page.mouse.move(point.x, point.y);
	await page.evaluate(() => window.dispatchEvent(new Event('release-offline-install')));
	await expect(indicator).toHaveText('Prêt hors ligne', { timeout: 20_000 });
	const after = await button.boundingBox();
	await info.attach('toolbar-readiness.json', {
		body: JSON.stringify({ before, after, point }),
		contentType: 'application/json'
	});
	expect(after).not.toBeNull();
	expect(Math.abs(after!.x - before!.x)).toBeLessThan(0.5);
	await page.mouse.click(point.x, point.y);
	await expect(button).toHaveAttribute('aria-checked', 'true');
	await expect(page.locator('.mdsh-preview')).toContainText('First item');
	await info.attach('stable-toolbar.png', {
		body: await page.screenshot(),
		contentType: 'image/png'
	});
});
