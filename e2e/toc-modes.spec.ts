import { expect, test } from '@playwright/test';
import { createFirstFile, openPalette, resetAppState, writeSourceContent } from './helpers';

const fixture = [
	'---\ntitle: Outline fixture\n---',
	'# First',
	'```md\n# Hidden example\n```',
	...Array.from({ length: 30 }, (_, index) => `Paragraph ${index}.`),
	'## Repeated',
	'### Third',
	'#### Fourth',
	'##### Fifth',
	'###### Last',
	'## Repeated'
].join('\n\n');

test('the persistent outline navigates and updates in every document mode', async ({
	page
}, testInfo) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await resetAppState(page);
	await createFirstFile(page);
	await writeSourceContent(page, fixture);
	const toc = page.locator('.mdsh-toc-col nav');

	for (const mode of ['source', 'wysiwyg', 'read']) {
		await page.locator(`button[data-mode="${mode}"]`).click();
		await expect(toc).toBeVisible();
		await expect(toc.getByRole('button')).toHaveCount(7);
		await expect(toc).not.toContainText('Hidden example');
		await toc.getByRole('button', { name: 'Last', exact: true }).click();
		await expect(page.locator(`button[data-mode="${mode}"]`)).toHaveAttribute(
			'aria-checked',
			'true'
		);
		if (mode === 'source') {
			await expect(page.locator('.cm-content')).toBeFocused();
			await expect(toc.getByRole('button', { name: 'Last', exact: true })).toHaveAttribute(
				'aria-current',
				'location'
			);
			await page.keyboard.press('Home');
			await page.keyboard.press('End');
			await page.keyboard.type(' updated');
			await expect(toc.getByRole('button', { name: 'Last updated', exact: true })).toBeVisible();
			await page.keyboard.press('ControlOrMeta+z');
			await expect(toc.getByRole('button', { name: 'Last', exact: true })).toBeVisible();
		} else {
			const heading = page.locator(mode === 'read' ? '.mdsh-preview h6' : '.ProseMirror h6');
			await expect(heading).toBeInViewport();
			if (mode === 'wysiwyg') {
				await expect(page.locator('.ProseMirror')).toBeFocused();
				await page.keyboard.insertText('Edited ');
				await expect(toc.getByRole('button', { name: 'Edited Last', exact: true })).toBeVisible();
				await page.keyboard.press('ControlOrMeta+z');
			}
		}
		await testInfo.attach(`outline-${mode}`, {
			body: await page.screenshot(),
			contentType: 'image/png'
		});
	}
	await writeSourceContent(page, 'No headings remain.');
	await expect(page.locator('.mdsh-toc-col')).toBeHidden();
	await writeSourceContent(page, '# New heading');
	await expect(toc.getByRole('button', { name: 'New heading' })).toBeVisible();
	await page.reload();
	await expect(toc.getByRole('button', { name: 'New heading' })).toBeVisible();
	await page.setViewportSize({ width: 800, height: 900 });
	await expect(toc).toBeHidden();
	await testInfo.attach('outline-fixture', { body: fixture, contentType: 'text/markdown' });
});

test('keeps a long outline reachable and honors focus and visibility preferences', async ({
	page
}, testInfo) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await resetAppState(page);
	await createFirstFile(page);
	const longFixture = Array.from(
		{ length: 300 },
		(_, index) => `## Section ${index + 1}\n\nParagraph ${index + 1}.`
	).join('\n\n');
	await writeSourceContent(page, longFixture);
	const toc = page.locator('.mdsh-toc-col nav');
	await expect(toc.getByRole('button')).toHaveCount(300);
	const last = toc.getByRole('button', { name: 'Section 300', exact: true });
	await last.click();
	await expect(last).toBeInViewport();
	await expect(last).toHaveAttribute('aria-current', 'location');
	await page.keyboard.press('ControlOrMeta+Home');
	await expect(toc.getByRole('button', { name: 'Section 1', exact: true })).toHaveAttribute(
		'aria-current',
		'location'
	);
	await page.keyboard.press('ControlOrMeta+Shift+.');
	await expect(page.locator('.mdsh-toc-col')).toHaveCount(0);
	await page.keyboard.press('ControlOrMeta+Shift+.');
	await expect(toc).toBeVisible();
	await openPalette(page);
	await page.getByRole('combobox').fill('Masquer la table des matières');
	await page.getByRole('option').first().click();
	await expect(page.locator('.mdsh-toc-col')).toHaveCount(0);
	await page.reload();
	await expect(page.locator('.cm-content')).toBeVisible();
	await expect(page.locator('.mdsh-toc-col')).toHaveCount(0);
	await openPalette(page);
	await page.getByRole('combobox').fill('Afficher la table des matières');
	await page.getByRole('option').first().click();
	await expect(toc).toBeVisible();
	await page.locator('button[data-mode="read"]').click();
	await expect(toc.getByRole('button')).toHaveCount(300);
	await last.click();
	await expect(page.locator('.mdsh-preview h2').last()).toBeInViewport();
	await expect(last).toBeInViewport();
	await testInfo.attach('long-outline', {
		body: await page.screenshot(),
		contentType: 'image/png'
	});
	await testInfo.attach('long-outline-fixture', {
		body: longFixture,
		contentType: 'text/markdown'
	});
});
