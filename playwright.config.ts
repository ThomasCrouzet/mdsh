import { defineConfig, devices } from '@playwright/test';

const e2ePort = process.env.E2E_PORT ?? '4173';
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;

/**
 * Config E2E Playwright - tests de scénarios utilisateur bout-en-bout.
 * Chromium : suite complète (FSA + golden-path + mobile).
 * WebKit   : golden-path uniquement (FSA non supportée hors Chromium).
 */
export default defineConfig({
	testDir: './e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	// 2 retries en CI pour d'éventuels aléas CPU/réseau. Le seeding force désormais
	// explicitement le mode source (cf. helpers.writeSourceContent) → plus de
	// dépendance à la restauration asynchrone de `mdsh:mode`.
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: process.env.CI ? [['github'], ['list']] : 'list',
	use: {
		baseURL: e2eBaseUrl,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		// The UI defaults to English (i18n layer) and auto-detects navigator.language.
		// The e2e specs assert the French strings, so we pin the browser locale to fr-FR
		// (English is covered by the i18n unit tests: en/fr key parity + default-locale).
		locale: 'fr-FR'
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
			// Les specs mobile attendent le drawer Sidebar : on les exclut côté desktop.
			testIgnore: '**/mobile.spec.ts'
		},
		{
			// Viewport mobile pour valider la Sidebar en drawer, les touch targets
			// et la responsivité globale. Ne tourne QUE sur `mobile.spec.ts` -
			// les autres parcours sont couverts par le projet desktop.
			// On utilise Pixel 5 (et non iPhone 13) car ce profil a
			// `defaultBrowserType: 'chromium'` ; la CI n'installe que Chromium
			// via `npx playwright install --with-deps chromium`.
			name: 'mobile-chromium',
			use: { ...devices['Pixel 5'] },
			testMatch: '**/mobile.spec.ts'
		},
		{
			name: 'firefox',
			use: { ...devices['Desktop Firefox'] },
			testMatch: '**/golden-path.spec.ts'
		},
		{
			// WebKit covers persistence, localization, and command interactions.
			// FSA-dependent tests remain intentionally limited to Chromium.
			name: 'webkit',
			use: { ...devices['Desktop Safari'] },
			testMatch: ['**/golden-path.spec.ts', '**/locale-en.spec.ts', '**/palette.spec.ts']
		}
	],
	webServer: {
		command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${e2ePort} --strictPort`,
		url: e2eBaseUrl,
		// Ne jamais réutiliser un serveur inconnu : un autre projet sur le même port
		// ferait passer ou échouer les tests contre la mauvaise application.
		reuseExistingServer: false,
		timeout: 120_000,
		stdout: 'pipe',
		stderr: 'pipe'
	}
});
