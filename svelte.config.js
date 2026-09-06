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
			// With ssr = false, static HTML contains only the hydration shell.
			// Internal anchors, including the #main skip link, resolve after hydration.
			handleMissingId: 'ignore'
		},
		csp: {
			mode: 'hash',
			directives: {
				'default-src': ['self'],
				// No runtime dependency creates WebAssembly instances (checked with mermaid 11.16, katex, and highlight.js).
				// Do not add wasm-unsafe-eval.
				// Mermaid/KaTeX e2e tests use the built app with this CSP.
				// They check whether a future dependency needs WebAssembly.
				'script-src': ['self'],
				'style-src': ['self', 'unsafe-inline'],
				'font-src': ['self', 'data:'],
				'img-src': ['self', 'data:', 'blob:'],
				'media-src': ['self', 'blob:'],
				'connect-src': ['self', 'https:'],
				'worker-src': ['self', 'blob:'],
				'base-uri': ['self'],
				'form-action': ['none'],
				// Block iframes. The app does not need them.
				// Mermaid uses its own sandbox with `securityLevel: strict`, independently of CSP.
				'frame-src': ['none'],
				// Prevent third-party sites from embedding mdsh (clickjacking).
				'frame-ancestors': ['none'],
				// Block `<object>`, `<embed>`, and `<applet>`. The app does not need them.
				'object-src': ['none']
			}
		}
	}
};

export default config;
