import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
	// The Svelte plugin transforms .svelte components for unit tests with @testing-library/svelte.
	plugins: [svelte()],
	test: {
		environment: 'jsdom',
		// Give jsdom a non-opaque URL. The default `about:blank` makes `localStorage` unavailable.
		// Theme, locale, editor width, and UI preference stores need it in tests.
		environmentOptions: { jsdom: { url: 'http://localhost:5173/' } },
		include: ['src/**/*.{test,spec}.ts'],
		exclude: ['**/*.svelte.{test,spec}.ts'],
		setupFiles: ['src/lib/test-setup.ts'],
		globals: true,
		coverage: {
			provider: 'v8',
			reporter: ['text-summary', 'json-summary', 'html', 'lcov'],
			// Measure application logic in `.ts` modules and `.svelte.ts` runes stores.
			// Playwright and selected component tests cover `.svelte` components outside the unit threshold.
			// A 95% line target for UI components, including Editor/Milkdown, would encourage fragile tests.
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
				// Playwright covers framework and DOM integration. Unit tests would be fragile here.
				// These modules connect window/pointer/$effect behavior, service worker registration
				// (a virtual module), the Milkdown editor hook, and the search Web Worker.
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
			'$app/paths': resolve('./src/lib/test-paths.ts'),
			'virtual:pwa-register': resolve('./src/lib/test-pwa-register.ts')
		}
	}
});
