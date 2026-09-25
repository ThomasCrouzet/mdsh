import { expect, test } from '@playwright/test';
import { createFirstFile, resetAppState } from './helpers';

test('uses the reported keyboard platform before a Safari-compatible user agent', async ({
	page
}, testInfo) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'platform', { get: () => 'Linux x86_64' });
		Object.defineProperty(navigator, 'userAgent', {
			get: () =>
				'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15'
		});
	});
	await resetAppState(page);
	await createFirstFile(page);
	await page.locator('button[data-mode="source"]').click();
	await expect(page.locator('.cm-content')).toBeVisible();
	await page.locator('.cm-content').click();
	await page.keyboard.insertText('Keyboard platform document');
	await page.keyboard.press('Control+,');
	await expect(page.getByRole('dialog', { name: 'Réglages', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Fermer', exact: true }).click();
	await expect(
		page.locator('aside').getByRole('button', { name: /Nouveau fichier, raccourci Ctrl\+N/ })
	).toBeVisible();
	await testInfo.attach('keyboard-platform', {
		body: JSON.stringify(
			await page.evaluate(() => ({ platform: navigator.platform, userAgent: navigator.userAgent }))
		),
		contentType: 'application/json'
	});
});
