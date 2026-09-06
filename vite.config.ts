import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig, loadEnv } from 'vite';
import { bundleGraphPlugin } from './scripts/bundle-graph.mjs';

// Served base path (`paths.base` in production).
// The manifest transform maps `index.html` to this base path.
const PWA_BASE = process.env.BASE_PATH ?? '';

export default defineConfig(({ mode }) => {
	// Vite does not load `.env.local` into `process.env` for this configuration.
	// Application code receives it through `import.meta.env`. Use `loadEnv` here.
	const env = loadEnv(mode, process.cwd(), 'VITE_');
	// Contributors can add short MagicDNS hostnames outside `.ts.net`.
	// Keep machine-specific names in `.env.local`: VITE_DEV_ALLOWED_HOSTS=my-machine.
	const extraAllowedHosts = (env.VITE_DEV_ALLOWED_HOSTS ?? '')
		.split(',')
		.map((h) => h.trim())
		.filter(Boolean);

	return {
		server: {
			// The development server binds to the Tailscale IP (see `make dev`).
			// Allow MagicDNS Host headers without triggering DNS rebinding protection.
			// `.ts.net` covers `<machine>.tail-XXXX.ts.net`.
			// Use `VITE_DEV_ALLOWED_HOSTS` for additional short hostnames.
			// Vite reads `server.*` only in development and preview, not production.
			allowedHosts: ['.ts.net', ...extraAllowedHosts]
		},
		define: {
			// Mermaid includes Vue (esm-bundler), which needs these tree-shaking flags.
			// These flags prevent console warnings and improve dead-code removal.
			__VUE_OPTIONS_API__: 'false',
			__VUE_PROD_DEVTOOLS__: 'false',
			__VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false'
		},
		plugins: [
			tailwindcss(),
			sveltekit(),
			bundleGraphPlugin(),
			SvelteKitPWA({
				// §1.2 - `prompt` lets `onNeedRefresh` show a Reload notification (see ui/pwa-update).
				// Do not reload while the user writes in the editor.
				registerType: 'prompt',
				strategies: 'generateSW',
				// `auto` detects the `virtual:pwa-register` import in ui/pwa-update.
				// The plugin does not add a second registration.
				injectRegister: 'auto',
				manifest: {
					name: 'mdsh - local-first markdown editor',
					short_name: 'mdsh',
					description: 'A local-first offline Markdown workspace with light and dark themes.',
					theme_color: '#0b0c0d',
					background_color: '#0b0c0d',
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
					// Chrome and Android show these screenshots in the installation prompt.
					// Use `form_factor: wide` for these 2560x1600 desktop screenshots.
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
					// Download each engine and its resources for offline use.
					// Do not evaluate JavaScript before it is needed.
					globPatterns: [
						'client/_app/immutable/entry/*.js',
						'client/_app/immutable/nodes/*.js',
						'client/_app/immutable/chunks/*.js',
						// Precache the cross-file search worker for the first offline start.
						// Without this entry, offline search has no cached worker.
						// The worker is about 1.2 KB, below the chunk size limit.
						'client/_app/immutable/workers/*.js',
						'client/_app/immutable/assets/*.{css,woff2}',
						'client/print/*.css',
						'client/katex/**/*.css',
						'client/katex/**/*.woff2',
						// adapter-static serves `index.html` as the SPA fallback.
						// Workbox reads the pre-adapter output, which has no such file in `.svelte-kit/output/client/`.
						// Workbox creates the service worker fallback from `navigateFallback` below.
						'client/favicon.{ico,svg}',
						'client/apple-touch-icon-180x180.png',
						'client/maskable-icon-512x512.png',
						'client/pwa-{64x64,192x192,512x512}.png',
						'client/manifest.webmanifest'
					],
					maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
					// Keep the plugin URL mapping and the exact root path.
					// This also applies when BASE_PATH=/mdsh.
					manifestTransforms: [
						(entries) => {
							const manifest = entries
								// Map to the served URL (see the plugin createManifestTransform).
								.map((e) => {
									let url = e.url;
									if (url.startsWith('client/')) url = url.slice(7);
									else if (url.startsWith('prerendered/dependencies/')) url = url.slice(25);
									else if (url.startsWith('prerendered/pages/')) url = url.slice(18);
									if (url.endsWith('.html')) {
										if (url.startsWith('/')) url = url.slice(1);
										// Precache `index.html` at the URL that the browser requests.
										// Use the base root with a final slash: `/` locally or `/mdsh/` on Pages.
										// Without the slash, `/mdsh` matched neither navigation nor `navigateFallback`.
										// The app could not start offline. With an empty base, an empty entry
										// prevented precache installation and left the cache empty.
										url =
											url === 'index.html' ? `${PWA_BASE}/` : url.slice(0, url.lastIndexOf('.'));
									}
									return { ...e, url };
								})
								// Serve the webmanifest at runtime. Do not precache it, as with the plugin.
								.filter((e) => e.url !== 'manifest.webmanifest');
							return { manifest };
						}
					],
					// Offline navigation uses the cached SPA shell at the base root with a final slash.
					// This includes an installed PWA restart and a page reload.
					// Match the precache key exactly (see manifestTransforms).
					// Otherwise, `createHandlerBoundToURL` finds no entry and the page stays blank.
					navigateFallback: `${PWA_BASE}/`,
					navigateFallbackDenylist: [/^\/api/],
					// Precache revisions also replace print CSS and fonts with each update.
					// Do not keep a separate 30-day cache.
					cleanupOutdatedCaches: true
				},
				devOptions: {
					enabled: false
				}
			})
		],
		build: {
			rollupOptions: {
				output: {
					// Group only lazy-loaded libraries large enough to need a separate chunk.
					// In commit 3f5b5ad, grouping Mermaid moved `__vitePreload` into its chunk.
					// The app entry then imported Mermaid statically and loaded 2.5 MiB before first paint.
					// Only render/markdown.ts uses DOMPurify; that module belongs to render-core.
					// After the build, check that the entry does not import these chunks statically.
					// See the production build troubleshooting instructions.
					//
					// §1.4 - Do not force Mermaid into a manual chunk.
					// The June 2026 build confirmed that Rollup already creates its separate chunk (about 115 KB gzip).
					// Both render/markdown.ts and milkdown-mermaid-preview.ts use dynamic imports.
					// The renderer also checks `mermaidCodes.length > 0`.
					// Mermaid stays outside the static entry/node graph. Documents without diagrams do not load it.
					// This meets the roadmap isolation requirement.
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
