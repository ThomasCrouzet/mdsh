import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig, loadEnv } from 'vite';

// Base servie (= `paths.base` SvelteKit en prod). Sert au mapping `index.html`
// → base dans le transform de manifeste ci-dessous (cf. manifestTransforms).
const PWA_BASE = process.env.BASE_PATH ?? '';

export default defineConfig(({ mode }) => {
	// Vite ne charge PAS automatiquement `.env.local` dans `process.env` pour
	// ce fichier de config (seul le code app le reçoit via `import.meta.env`) -
	// `loadEnv` est requis pour lire une valeur ici.
	const env = loadEnv(mode, process.cwd(), 'VITE_');
	// Hostnames MagicDNS supplémentaires (short hostnames hors `.ts.net`) à
	// autoriser sur le dev server, propres à la machine de chaque contributeur -
	// jamais codés en dur ici. Ex. `.env.local` : VITE_DEV_ALLOWED_HOSTS=my-machine
	const extraAllowedHosts = (env.VITE_DEV_ALLOWED_HOSTS ?? '')
		.split(',')
		.map((h) => h.trim())
		.filter(Boolean);

	return {
		server: {
			// Le dev server (cf. `make dev`) bind sur l'IP Tailscale ; on autorise
			// les hostnames MagicDNS du tailnet à frapper le Host header sans
			// déclencher la protection DNS rebinding de Vite. `.ts.net` couvre les
			// FQDN `<machine>.tail-XXXX.ts.net` ; un short hostname additionnel se
			// configure via `VITE_DEV_ALLOWED_HOSTS` (cf. ci-dessus). Aucune
			// incidence en prod (Vite ne lit `server.*` qu'en dev / preview).
			allowedHosts: ['.ts.net', ...extraAllowedHosts]
		},
		define: {
			// Mermaid embarque Vue (esm-bundler) qui réclame ces flags pour le
			// tree-shaking. Les définir évite le warning console et améliore le
			// dead-code elimination dans le chunk mermaid.
			__VUE_OPTIONS_API__: 'false',
			__VUE_PROD_DEVTOOLS__: 'false',
			__VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false'
		},
		plugins: [
			tailwindcss(),
			sveltekit(),
			SvelteKitPWA({
				// §1.2 - `prompt` (et non `autoUpdate`) : une nouvelle version ne
				// s'installe pas en silence - `onNeedRefresh` (cf. ui/pwa-update)
				// affiche un toast « Recharger ». Crucial pour un ÉDITEUR : pas de
				// rechargement-surprise en pleine frappe.
				registerType: 'prompt',
				strategies: 'generateSW',
				// `auto` : comme on importe `virtual:pwa-register` (ui/pwa-update),
				// le plugin n'injecte PAS de second enregistrement - pas de doublon.
				injectRegister: 'auto',
				manifest: {
					name: 'mdsh - local-first markdown editor',
					short_name: 'mdsh',
					description: 'A local-first WYSIWYG markdown editor, 100% dark, offline.',
					theme_color: '#14161a',
					background_color: '#14161a',
					display: 'standalone',
					orientation: 'any',
					start_url: '.',
					scope: '.',
					lang: 'en',
					categories: ['productivity', 'utilities'],
					icons: [
						{ src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
						{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
						{ src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
						{
							src: 'maskable-icon-512x512.png',
							sizes: '512x512',
							type: 'image/png',
							purpose: 'maskable'
						}
					],
					// Richer install UI (Chrome/Android) : aperçus affichés dans le
					// prompt d'installation. `form_factor: 'wide'` car les captures
					// (2560x1600) sont des screenshots desktop.
					screenshots: [
						{
							src: 'screenshots/mode-wysiwyg.webp',
							sizes: '2560x1600',
							type: 'image/webp',
							form_factor: 'wide',
							label: 'WYSIWYG editing mode with math, code and a populated sidebar'
						},
						{
							src: 'screenshots/mode-source.webp',
							sizes: '2560x1600',
							type: 'image/webp',
							form_factor: 'wide',
							label: 'Source mode with markdown syntax highlighting'
						},
						{
							src: 'screenshots/mode-read.webp',
							sizes: '2560x1600',
							type: 'image/webp',
							form_factor: 'wide',
							label: 'Reading mode with a floating table of contents and backlinks'
						},
						{
							src: 'screenshots/palette.webp',
							sizes: '2560x1600',
							type: 'image/webp',
							form_factor: 'wide',
							label: 'Command palette with keyboard shortcuts'
						}
					],
					shortcuts: [
						{
							name: 'New file',
							short_name: 'New',
							description: 'Create a new markdown draft',
							url: './?action=new',
							icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }]
						},
						{
							// §2.11 - App shortcut: cross-file search.
							name: 'Search',
							short_name: 'Search',
							description: 'Open cross-file search',
							url: './?action=search',
							icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }]
						},
						{
							// §2.11 - App shortcut: command palette.
							name: 'Command palette',
							short_name: 'Commands',
							description: 'Open the command palette',
							url: './?action=palette',
							icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }]
						}
					],
					file_handlers: [
						{
							action: './',
							accept: {
								'text/markdown': ['.md', '.markdown', '.mdx'],
								'text/plain': ['.txt']
							}
						}
					],
					share_target: {
						action: './',
						method: 'GET',
						params: {
							title: 'title',
							text: 'text',
							url: 'url'
						}
					},
					launch_handler: {
						client_mode: 'focus-existing'
					},
					handle_links: 'preferred'
				},
				workbox: {
					// §A1.5 - Precache de la coquille d'app COMPLÈTE + features légères.
					// Inclut entry, nodes, TOUS les chunks ≤ 140 KB (toute la closure de
					// boot - dont `0.*.css` Tailwind render-blocking et le chunk
					// page+stores de 122 KB - ainsi que les chunks lazy légers), tous les
					// CSS, le shell HTML, les icônes et le manifest. Garantit qu'une
					// installation fraîche démarre ET rend un document HORS-LIGNE sans
					// dépendre du cache runtime (qui pouvait être évincé : cf. maxEntries).
					//
					// Exclues du precache (cap 140 KB ci-dessous) et servies en cache-on-use :
					// les 8 libs lourdes lazy (mermaid, codemirror, milkdown, marked, katex,
					// highlight.js, jszip ; 192 KB-768 KB) + les 60 fonts KaTeX (woff2/woff/ttf,
					// ~math export uniquement). Évite ~4,5 MB → on reste loin des 6,7 MB de
					// l'ancien precache tout-compris, tout en étant réellement offline-ready.
					globPatterns: [
						'client/_app/immutable/entry/*.js',
						'client/_app/immutable/nodes/*.js',
						'client/_app/immutable/chunks/*.js',
						// Worker de recherche cross-fichiers : précaché pour que la recherche
						// fonctionne au TOUT premier lancement hors-ligne (sinon le module
						// worker n'est jamais en cache et la recherche est muette offline).
						// ~1,2 KB, bien sous le cap chunks.
						'client/_app/immutable/workers/*.js',
						'client/_app/immutable/assets/*.css',
						// `index.html` est servi par adapter-static comme fallback SPA mais
						// n'est pas dans `.svelte-kit/output/client/` (workbox lit la sortie
						// pré-adapter). Le SW navigateFallback est généré par workbox lui-même
						// via la config navigateFallback (cf. plus bas si on l'ajoute).
						'client/favicon.{ico,svg}',
						'client/apple-touch-icon-180x180.png',
						'client/maskable-icon-512x512.png',
						'client/pwa-{64x64,192x192,512x512}.png',
						'client/manifest.webmanifest'
					],
					// Cap haut : sert uniquement à NE PAS faire échouer le build (le plugin
					// jette une erreur dès qu'un fichier glob-matché dépasse le cap). Le tri
					// réel coquille/libs-lourdes est fait par `manifestTransforms` ci-dessous.
					maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
					// Exclut du PRECACHE les chunks lazy lourds (> 140 KB) : libs de rendu
					// (mermaid, codemirror, milkdown, marked, katex, highlight.js, jszip).
					// Elles restent disponibles via `runtimeCaching` (cache-on-use). Tout le
					// reste - dont la closure statique de boot (max mesuré 122 KB) et les
					// chunks lazy légers - est précaché, ce qui rend l'app réellement
					// offline-ready dès le 1er install sans le poids des grosses libs.
					// ATTENTION : fournir `manifestTransforms` REMPLACE le transform interne
					// de @vite-pwa/sveltekit (il ne l'injecte QUE s'il est absent). Ce
					// transform interne réécrit les URLs de la sortie pré-adapter vers les
					// URLs SERVIES (strip `client/` / `prerendered/…`, `index.html` → base,
					// retrait du webmanifest). On le RÉPLIQUE fidèlement ici - sinon le SW
					// précacherait `/client/_app/…` et `/prerendered/pages/index.html` (404).
					// Ajout : exclusion par TAILLE des gros chunks lazy (impossible via
					// globIgnores, qui ne connaît pas les tailles).
					manifestTransforms: [
						(entries) => {
							const MAX = 140 * 1024;
							const manifest = entries
								// Exclut du precache les gros chunks lazy (libs de rendu).
								.filter((e) => !(/_app\/immutable\/chunks\//.test(e.url) && (e.size ?? 0) > MAX))
								// Réécriture vers l'URL servie (cf. createManifestTransform du plugin).
								.map((e) => {
									let url = e.url;
									if (url.startsWith('client/')) url = url.slice(7);
									else if (url.startsWith('prerendered/dependencies/')) url = url.slice(25);
									else if (url.startsWith('prerendered/pages/')) url = url.slice(18);
									if (url.endsWith('.html')) {
										if (url.startsWith('/')) url = url.slice(1);
										// `index.html` (fallback SPA) est précaché sous l'URL RÉELLEMENT
										// requise par le navigateur lors d'une navigation : la racine de
										// la base AVEC slash final (`/` en local, `/mdsh/` sur Pages). Sans
										// le slash, la clé de précache (`/mdsh`) ne matchait ni la requête
										// de navigation (`/mdsh/`) ni le `navigateFallback` → l'app ne
										// démarrait pas hors-ligne (et en base vide, l'entrée `''` faisait
										// même échouer l'install du précache → cache vide).
										url =
											url === 'index.html' ? `${PWA_BASE}/` : url.slice(0, url.lastIndexOf('.'));
									}
									return { ...e, url };
								})
								// Le webmanifest est servi au runtime, pas précaché (comme le plugin).
								.filter((e) => e.url !== 'manifest.webmanifest');
							return { manifest };
						}
					],
					// Toute navigation hors-ligne (relancement de la PWA installée, reload)
					// retombe sur le shell SPA précaché à la racine de la base AVEC slash
					// (cf. manifestTransforms). Doit matcher exactement la clé de précache,
					// sinon `createHandlerBoundToURL` ne trouve rien et l'app reste blanche.
					navigateFallback: `${PWA_BASE}/`,
					navigateFallbackDenylist: [/^\/api/],
					// §A3.1 - Runtime caching : tout le reste va en cache à l'usage. Les
					// chunks `_app/immutable/*` ont un hash dans le filename (immutable) :
					// CacheFirst sans expiration courte = parfait. Les assets static
					// (katex, print) ont aussi des paths stables.
					runtimeCaching: [
						{
							// Chunks lazy, fonts KaTeX bundlées par Vite, images.
							urlPattern: /\/_app\/immutable\//,
							handler: 'CacheFirst',
							options: {
								cacheName: 'mdsh-immutable-v1',
								expiration: {
									// 500 > total des fichiers `_app/immutable` (~320) : les libs
									// lourdes lazy + fonts KaTeX non précachées ne risquent plus
									// l'éviction LRU d'une génération de déploiement à l'autre.
									maxEntries: 500,
									maxAgeSeconds: 60 * 60 * 24 * 60 // 60 jours
								},
								cacheableResponse: { statuses: [0, 200] }
							}
						},
						{
							// Static katex/* (fonts servies à l'iframe d'impression PDF) +
							// print/print.css. Ces fichiers sont stables (pas de hash mais
							// changent peu) - on les met en cache 30 jours.
							urlPattern: /\/(katex|print)\//,
							handler: 'CacheFirst',
							options: {
								cacheName: 'mdsh-static-v1',
								expiration: {
									maxEntries: 80,
									maxAgeSeconds: 60 * 60 * 24 * 30
								},
								cacheableResponse: { statuses: [0, 200] }
							}
						}
					]
				},
				devOptions: {
					enabled: false
				}
			})
		],
		build: {
			rollupOptions: {
				output: {
					// Approche conservative : on ne regroupe QUE les libs lazy-loadées
					// dont la taille justifie un chunk dédié. Mermaid est exclu car la
					// tentative précédente (commit 3f5b5ad) faisait remonter le helper
					// `__vitePreload` dans le chunk mermaid → import statique par
					// l'entry app + 2,5 Mio first-paint. DOMPurify est consommé
					// uniquement par render/markdown.ts qui sera dans render-core.
					// On vérifie après build qu'aucun de ces chunks ne devient
					// statiquement importé par l'entry (cf. README "Build prod fail").
					//
					// §1.4 - Mermaid : NE PAS le forcer ici (cf. ci-dessus). Vérifié
					// au build (2026-06) : le `import('mermaid')` dynamique de
					// `render/markdown.ts` (sous garde `mermaidCodes.length > 0`) et de
					// `milkdown-mermaid-preview.ts` laisse déjà Rollup l'isoler dans son
					// propre chunk (~115 Ko gz). Il N'EST PAS dans le graphe statique de
					// l'entry/nodes, et un document sans diagramme ne le charge jamais.
					// L'isolation visée par la roadmap est donc déjà acquise par défaut.
					manualChunks(id: string): string | undefined {
						if (id.includes('node_modules/marked/')) return 'render-core';
						if (id.includes('node_modules/highlight.js/')) return 'render-highlight';
						if (id.includes('node_modules/katex/')) return 'render-math';
						if (id.includes('node_modules/jszip/')) return 'export-zip';
						if (id.includes('node_modules/js-yaml/')) return 'frontmatter';
						return undefined;
					}
				}
			}
		}
	};
});
