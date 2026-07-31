import { test, expect } from '@playwright/test';
import { resetAppState, seedFiles } from './helpers';

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

	test('Mermaid rendu en mode lecture', async ({ page }) => {
		await seedFiles(page, [
			{
				name: 'diagram',
				content: '# Diagramme\n\n```mermaid\ngraph LR\nA --> B\n```\n'
			}
		]);
		await page.locator('button[data-mode="read"]').click();
		// Mermaid produit un `<svg>` dans la zone preview. Le chunk est lazy +
		// le rendu est async → timeout large.
		await expect(page.locator('.mdsh-preview svg').first()).toBeVisible({
			timeout: 20_000
		});
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
