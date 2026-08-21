/**
 * Axe-core accessibility scan for release-blocking serious/critical issues.
 * Complements e2e/a11y.spec.ts (skip-link + focus trap).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { resetAppState, createFirstFile, openPalette } from './helpers';

function violationSummary(
	violations: Array<{ impact: string | null; id: string; nodes: Array<{ target: unknown }> }>
): string {
	return violations
		.map(
			(violation) =>
				`${violation.impact}: ${violation.id} ${violation.nodes
					.map((node) => JSON.stringify(node.target))
					.join(', ')}`
		)
		.join('\n');
}

async function expectNoBlockingViolations(builder: AxeBuilder): Promise<void> {
	const results = await builder.analyze();
	const blocking = results.violations.filter(
		(violation) => violation.impact === 'critical' || violation.impact === 'serious'
	);
	expect(blocking, violationSummary(blocking)).toEqual([]);
}

test.describe('Axe accessibility scan', () => {
	test.beforeEach(async ({ page }) => {
		await resetAppState(page);
	});

	test('Welcome screen passes in light and dark themes', async ({ page }) => {
		for (const theme of ['light', 'dark'] as const) {
			await page.evaluate(
				(selectedTheme) => localStorage.setItem('mdsh:theme', selectedTheme),
				theme
			);
			await page.reload();
			await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
			await expectNoBlockingViolations(new AxeBuilder({ page }));
		}
	});

	test('Source editor and palette pass in light and dark themes', async ({ page }) => {
		await createFirstFile(page);
		for (const theme of ['light', 'dark'] as const) {
			await page.evaluate(
				(selectedTheme) => localStorage.setItem('mdsh:theme', selectedTheme),
				theme
			);
			await page.reload();
			await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
			await expect(page.locator('.cm-content')).toHaveAttribute('aria-label');
			await openPalette(page);
			await expect(page.locator('.mdsh-dialog-panel')).toHaveCSS('opacity', '1');
			await expectNoBlockingViolations(new AxeBuilder({ page }).include('.mdsh-dialog-panel'));
			await page.keyboard.press('Escape');
		}
	});

	test('WYSIWYG, reading view, and Settings pass in light and dark themes', async ({ page }) => {
		await createFirstFile(page);
		for (const theme of ['light', 'dark'] as const) {
			await page.evaluate(
				(selectedTheme) => localStorage.setItem('mdsh:theme', selectedTheme),
				theme
			);
			await page.reload();
			await page.locator('button[data-mode="wysiwyg"]').click();
			await expect(page.locator('.ProseMirror')).toHaveAttribute('aria-label');
			await expectNoBlockingViolations(new AxeBuilder({ page }).include('#main'));

			await page.locator('button[data-mode="read"]').click();
			await expect(page.locator('.mdsh-preview')).toBeVisible();
			await expectNoBlockingViolations(new AxeBuilder({ page }).include('#main'));

			await page.keyboard.press('ControlOrMeta+,');
			await expect(page.getByRole('dialog')).toBeVisible();
			await expect(page.locator('.mdsh-dialog-panel')).toHaveCSS('opacity', '1');
			await expectNoBlockingViolations(new AxeBuilder({ page }).include('[role="dialog"]'));
			await page.keyboard.press('Escape');
		}
	});

	test('mobile welcome and source workspace have no blocking violations', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		for (const theme of ['light', 'dark'] as const) {
			await resetAppState(page);
			await page.evaluate(
				(selectedTheme) => localStorage.setItem('mdsh:theme', selectedTheme),
				theme
			);
			await page.reload();
			await expectNoBlockingViolations(new AxeBuilder({ page }));
		}
		await page.locator('main [data-testid="welcome-new"]').click();
		await expect(page.locator('.cm-content')).toBeVisible();
		await expect(page.locator('.cm-content')).toHaveAttribute('aria-label');
		await expectNoBlockingViolations(new AxeBuilder({ page }).include('#main'));
	});
});
