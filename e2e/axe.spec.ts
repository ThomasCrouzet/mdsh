/**
 * Axe-core accessibility scan (informational for serious/critical).
 * Complements e2e/a11y.spec.ts (skip-link + focus trap).
 * Non-blocking in CI: we log violations and only fail on `critical` impact.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { resetAppState, createFirstFile, openPalette } from './helpers';

test.describe('Axe accessibility scan', () => {
	test.beforeEach(async ({ page }) => {
		await resetAppState(page);
	});

	test('Welcome screen has no critical axe violations', async ({ page }) => {
		const results = await new AxeBuilder({ page }).analyze();
		const critical = results.violations.filter((v) => v.impact === 'critical');
		if (results.violations.length) {
			// Surface detail in the Playwright report without failing on moderate noise.
			console.log(
				'[axe welcome]',
				results.violations.map((v) => `${v.impact}: ${v.id} (${v.nodes.length})`).join('; ')
			);
		}
		expect(critical, JSON.stringify(critical, null, 2)).toEqual([]);
	});

	test('Source editor + palette have no critical axe violations', async ({ page }) => {
		await createFirstFile(page);
		await openPalette(page);
		const results = await new AxeBuilder({ page }).include('body').analyze();
		const critical = results.violations.filter((v) => v.impact === 'critical');
		if (results.violations.length) {
			console.log(
				'[axe editor+palette]',
				results.violations.map((v) => `${v.impact}: ${v.id} (${v.nodes.length})`).join('; ')
			);
		}
		expect(critical, JSON.stringify(critical, null, 2)).toEqual([]);
	});
});
