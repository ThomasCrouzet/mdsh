import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import svelteParser from 'svelte-eslint-parser';
import tsParser from '@typescript-eslint/parser';

export default [
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs['flat/recommended'],
	prettier,
	...svelte.configs['flat/prettier'],
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node
			}
		}
	},
	{
		// Composants `.svelte` ET modules runes `.svelte.ts` (stores) : tous deux
		// parsés par svelte-eslint-parser (conscience des runes `$state`/`$derived`/
		// `$effect`), avec typescript-eslint pour le TypeScript embarqué.
		files: ['**/*.svelte', '**/*.svelte.ts'],
		languageOptions: {
			parser: svelteParser,
			parserOptions: {
				parser: tsParser
			}
		}
	},
	{
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
			],
			// `error` (et non `warn`) : les stores `.svelte.ts` sont désormais lintés
			// (l'ignore global a été retiré) et doivent rester exempts de `any`.
			'@typescript-eslint/no-explicit-any': 'error',
			// §1.3 - Toute journalisation passe par `report.ts` (reportError /
			// reportWarning) ou `storage.ts` (reportPersistenceError), seuls
			// fichiers autorisés à appeler `console` (cf. override ci-dessous).
			// Empêche la réapparition de `console.error` muets ailleurs.
			'no-console': 'error',
			// §A4.3 - Bloque les imports statiques des libs lourdes prescrites en
			// lazy : un import statique fait tomber la lib dans le page chunk
			// (cf. budget size-limit à 60 KB gz et ARCHITECTURE.md, section bundle
			// budget). Les fichiers déjà lazy-loadés (cf. overrides ci-dessous)
			// peuvent les importer statiquement : ils tombent alors dans leur
			// propre chunk lazy.
			'no-restricted-imports': [
				'error',
				{
					paths: [
						{ name: 'marked', message: 'Lazy-load only (see ARCHITECTURE.md).' },
						{ name: 'mermaid', message: 'Lazy-load only (see ARCHITECTURE.md).' },
						{ name: 'jszip', message: 'Lazy-load only (see ARCHITECTURE.md).' },
						{ name: 'js-yaml', message: 'Lazy-load only (see ARCHITECTURE.md).' },
						{ name: 'dompurify', message: 'Lazy-load only (see ARCHITECTURE.md).' },
						{ name: 'katex', message: 'Lazy-load only (see ARCHITECTURE.md).' },
						{ name: 'highlight.js', message: 'Lazy-load only (see ARCHITECTURE.md).' }
					],
					patterns: [
						{ group: ['katex/*'], message: 'Lazy-load only (see ARCHITECTURE.md).' },
						{ group: ['highlight.js/*'], message: 'Lazy-load only (see ARCHITECTURE.md).' },
						{ group: ['mermaid/*'], message: 'Lazy-load only (see ARCHITECTURE.md).' }
					]
				}
			]
		}
	},
	{
		// §1.3 - Les deux sinks de journalisation sanctionnés : ils sont seuls
		// autorisés à appeler `console` directement (tout le reste route via eux).
		files: ['src/lib/report.ts', 'src/lib/storage.ts'],
		rules: {
			'no-console': 'off'
		}
	},
	{
		// Les tests (spy sur console) et les benchmarks (sortie console assumée)
		// ne sont pas du code de prod - `no-console` n'y a pas de sens.
		files: ['**/*.test.ts', '**/*.spec.ts', '**/*.bench.test.ts'],
		rules: {
			'no-console': 'off'
		}
	},
	{
		// §A4.3 - Whitelist : ces fichiers sont eux-mêmes lazy-loadés (cf. les
		// dynamic imports dans `services/export.ts`, `Editor.svelte`,
		// `ReadView.svelte`, `+page.svelte` prefetch). Leurs imports statiques
		// tombent donc dans des chunks séparés du page chunk - pas de violation
		// du budget initial.
		files: [
			'src/lib/render/**/*.ts',
			'src/lib/services/export.ts',
			'src/lib/milkdown-mermaid-preview.ts'
		],
		rules: {
			'no-restricted-imports': 'off'
		}
	},
	{
		// Scripts Node utilitaires (capture screenshots, OG image, preview Pages) :
		// CLI hors-app où `console` EST la sortie voulue. `no-console: error` ne
		// vise que le code applicatif de `src/`.
		files: ['scripts/**/*.mjs', 'scripts/**/*.js'],
		rules: {
			'no-console': 'off'
		}
	},
	{
		ignores: ['build/', 'coverage/', '.svelte-kit/', 'node_modules/', 'package-lock.json', 'dist/']
	}
];
