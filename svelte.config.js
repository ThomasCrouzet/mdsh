import adapter from '@sveltejs/adapter-static';

const dev = process.env.NODE_ENV !== 'production';
const repoBase = process.env.BASE_PATH ?? '';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		adapter: adapter({
			fallback: 'index.html',
			precompress: false,
			strict: true
		}),
		paths: {
			base: dev ? '' : repoBase
		},
		prerender: {
			// ssr = false : l'HTML statique ne contient que la coquille d'hydratation,
			// les ancres internes (#main du skip link) sont résolues après hydratation.
			handleMissingId: 'ignore'
		},
		csp: {
			mode: 'hash',
			directives: {
				'default-src': ['self'],
				// No 'wasm-unsafe-eval': no runtime dependency instantiates
				// WebAssembly (checked on mermaid 11.16, katex, highlight.js).
				// The e2e Mermaid/KaTeX render tests run against the built app,
				// where this CSP applies - they gate a future WASM consumer.
				'script-src': ['self'],
				'style-src': ['self', 'unsafe-inline'],
				'font-src': ['self', 'data:'],
				'img-src': ['self', 'data:', 'blob:', 'https:'],
				'media-src': ['self', 'blob:'],
				'connect-src': ['self'],
				'worker-src': ['self', 'blob:'],
				'base-uri': ['self'],
				'form-action': ['none'],
				// Bloque toute iframe (pas de `<iframe>` dans l'app ; Mermaid
				// `securityLevel: 'strict'` sandboxe les siennes sans passer par CSP).
				'frame-src': ['none'],
				// Empêche l'embed de mdsh dans un site tiers (clickjacking).
				'frame-ancestors': ['none'],
				// Bloque `<object>`/`<embed>`/`<applet>` - aucun besoin.
				'object-src': ['none']
			}
		}
	}
};

export default config;
