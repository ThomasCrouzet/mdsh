import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
	// Le plugin svelte est nécessaire pour transformer les composants .svelte
	// dans les tests unitaires via @testing-library/svelte.
	plugins: [svelte()],
	test: {
		environment: 'jsdom',
		// URL non-opaque : sans elle jsdom sert `about:blank` (origine opaque) et
		// `localStorage` est indisponible, ce qui empêche de tester les stores qui
		// y persistent (theme, locale, largeur d'éditeur, préférences UI).
		environmentOptions: { jsdom: { url: 'http://localhost:5173/' } },
		include: ['src/**/*.{test,spec}.ts'],
		exclude: ['**/*.svelte.{test,spec}.ts'],
		setupFiles: ['src/lib/test-setup.ts'],
		globals: true,
		coverage: {
			provider: 'v8',
			reporter: ['text-summary', 'json-summary', 'html', 'lcov'],
			// Surface mesurée = logique applicative (modules `.ts` et stores runes
			// `.svelte.ts`). Les composants `.svelte` sont couverts par les tests e2e
			// Playwright et des tests de composants ciblés, pas par le seuil unitaire :
			// viser 95% de lignes sur des composants de présentation (Editor/Milkdown
			// inclus) produirait des tests fragiles et cosmétiques.
			include: ['src/lib/**/*.ts', 'src/lib/**/*.svelte.ts'],
			exclude: [
				'e2e/**',
				'**/*.config.*',
				'.svelte-kit/**',
				'src/lib/test-*.ts',
				'src/lib/**/*.test.ts',
				'src/lib/**/*.spec.ts',
				'src/lib/**/*.bench.test.ts',
				'src/lib/**/*.d.ts',
				'build/**',
				'scripts/**',
				// Framework / DOM glue, exercised by the Playwright e2e suite rather than
				// unit tests (a unit harness would be brittle and low-value): the runes
				// factories that wire window/pointer/$effect side effects, the PWA
				// service-worker registration (virtual module), the Milkdown editor hook,
				// and the search Web Worker.
				'src/lib/ui/editor-width.svelte.ts',
				'src/lib/ui/file-intents.svelte.ts',
				'src/lib/ui/prefs.svelte.ts',
				'src/lib/ui/prefetch.svelte.ts',
				'src/lib/ui/pwa-update.ts',
				'src/lib/milkdown-mermaid-preview.ts',
				'src/lib/workers/search.worker.ts'
			],
			thresholds: {
				statements: 95,
				branches: 90,
				functions: 90,
				lines: 95
			}
		}
	},
	resolve: {
		conditions: ['browser'],
		alias: {
			$lib: resolve('./src/lib'),
			'$app/environment': resolve('./src/lib/test-env.ts'),
			'$app/paths': resolve('./src/lib/test-paths.ts')
		}
	}
});
