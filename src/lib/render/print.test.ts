import { describe, it, expect, vi, afterEach, beforeEach, type Mock } from 'vitest';
import {
	buildPrintDocument,
	buildStandaloneHtmlDocument,
	printInIframe,
	PrintImageError,
	waitForPrintImages
} from './print';

describe('image decoding before print', () => {
	it('waits for decoded image pixels', async () => {
		const doc = document.implementation.createHTMLDocument();
		const image = doc.createElement('img');
		image.src = 'data:image/png;base64,AAAA';
		doc.body.appendChild(image);
		const decode = vi.fn(async () => {
			Object.defineProperty(image, 'naturalWidth', { value: 192 });
			Object.defineProperty(image, 'naturalHeight', { value: 192 });
		});
		image.decode = decode;
		await expect(waitForPrintImages(doc)).resolves.toBeUndefined();
		expect(decode).toHaveBeenCalledOnce();
	});

	it('rejects an unreadable image before it opens an incomplete PDF', async () => {
		const doc = document.implementation.createHTMLDocument();
		doc.body.innerHTML = '<img src="data:image/png;base64,AAAA" alt="Figure">';
		const image = doc.querySelector('img')!;
		image.decode = vi.fn(async () => {
			throw new Error('decode failed');
		});
		await expect(waitForPrintImages(doc)).rejects.toBeInstanceOf(PrintImageError);
	});

	it('stops during decoding after cancellation', async () => {
		const doc = document.implementation.createHTMLDocument();
		doc.body.innerHTML = '<img src="data:image/png;base64,AAAA">';
		doc.querySelector('img')!.decode = () => new Promise(() => {});
		const controller = new AbortController();
		const pending = waitForPrintImages(doc, { signal: controller.signal });
		controller.abort();
		await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
	});
});

describe('buildPrintDocument - structure', () => {
	it('creates an HTML5 doctype with the default English language', () => {
		const html = buildPrintDocument({ title: 'Doc', bodyHtml: '<p>hello</p>' });
		expect(html.startsWith('<!doctype html>')).toBe(true);
		// DEFAULT_LOCALE is English - not hardcoded French.
		expect(html).toContain('<html lang="en">');
	});

	it('uses an explicit English or French language', () => {
		expect(buildPrintDocument({ title: 'T', bodyHtml: '', lang: 'fr' })).toContain(
			'<html lang="fr">'
		);
		expect(buildPrintDocument({ title: 'T', bodyHtml: '', lang: 'en' })).toContain(
			'<html lang="en">'
		);
	});

	it('uses English when the language is empty or blank', () => {
		expect(buildPrintDocument({ title: 'T', bodyHtml: '', lang: '   ' })).toContain(
			'<html lang="en">'
		);
	});

	it('keeps the document title in metadata only', () => {
		const html = buildPrintDocument({ title: 'Mon document', bodyHtml: '<p>x</p>' });
		expect(html).toContain('<title>Mon document</title>');
		expect(html).not.toContain('<h1>Mon document</h1>');
		expect(html).not.toContain('print-header');
		expect(html).not.toContain('print-kicker');
	});

	it('preserves the author-written title exactly', () => {
		const bodyHtml = '<h1>Titre auteur</h1><p>body</p>';
		const html = buildPrintDocument({ title: 'Nom de fichier', bodyHtml });
		expect(html.match(/<h1>/g)).toHaveLength(1);
		expect(html).toContain(bodyHtml);
	});

	it('inserts the body in the print-body main element', () => {
		const html = buildPrintDocument({ title: 'T', bodyHtml: '<article>contenu</article>' });
		expect(html).toMatch(/<main class="print-body">[\s\S]*<article>contenu<\/article>/);
	});
});

describe('buildPrintDocument - security', () => {
	it('escapes angle brackets and ampersands in the title', () => {
		const html = buildPrintDocument({
			title: '<script>alert(1)</script> & "quoted"',
			bodyHtml: ''
		});
		expect(html).not.toContain('<script>alert(1)</script>');
		expect(html).toContain('&lt;script&gt;');
		expect(html).toContain('&amp;');
		expect(html).toContain('&quot;');
	});

	it('includes a restrictive CSP that blocks scripts', () => {
		const html = buildPrintDocument({ title: 'T', bodyHtml: '' });
		expect(html).toMatch(/http-equiv="Content-Security-Policy"/i);
		expect(html).toMatch(/script-src 'none'/);
		expect(html).toMatch(/object-src 'none'/);
		expect(html).toMatch(/form-action 'none'/);
	});
});

describe('buildPrintDocument - conditional KaTeX', () => {
	it('includes katex.min.css when the source contains math', () => {
		const html = buildPrintDocument({
			title: 'T',
			bodyHtml: '<p>rendered math</p>',
			source: 'Soit $a^2$'
		});
		expect(html).toContain('katex/katex.min.css');
	});

	it('includes katex.min.css when the body contains a katex class', () => {
		const html = buildPrintDocument({
			title: 'T',
			bodyHtml: '<span class="katex">x</span>'
		});
		expect(html).toContain('katex/katex.min.css');
	});

	it('includes the KaTeX link when the body contains math-block', () => {
		const html = buildPrintDocument({
			title: 'T',
			bodyHtml: '<div class="math-block">…</div>'
		});
		expect(html).toContain('katex/katex.min.css');
	});

	it('does not include katex.min.css without detected math', () => {
		const html = buildPrintDocument({
			title: 'T',
			bodyHtml: '<p>juste du texte</p>',
			source: 'juste du texte'
		});
		expect(html).not.toContain('katex/katex.min.css');
	});

	it('always includes print.css', () => {
		const html = buildPrintDocument({ title: 'T', bodyHtml: '' });
		expect(html).toContain('print/print.css');
	});
});

describe('buildStandaloneHtmlDocument', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	/** Mock `fetch` to return CSS text that is specific to each requested URL. */
	function stubCssFetch() {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				if (url.includes('/katex/fonts/')) {
					return {
						ok: true,
						status: 200,
						arrayBuffer: async () => new Uint8Array([0, 1, 2, 3]).buffer
					} as Response;
				}
				const body = url.includes('katex')
					? '.katex{font-size:1.1em}@font-face{src:url(fonts/KaTeX_Main.woff2)}'
					: '.print-body{color:#111}';
				return { ok: true, status: 200, text: async () => body } as Response;
			})
		);
	}

	it('embeds print.css in a style element and inserts the body', async () => {
		stubCssFetch();
		const html = await buildStandaloneHtmlDocument('Export', '<p>corps</p>');
		expect(html).toContain('<title>Export</title>');
		expect(html).toContain('<p>corps</p>');
		expect(html).toContain('<style>');
		expect(html).toContain('.print-body{color:#111}');
		// The result has no <link rel=stylesheet>, which makes it compatible with the file:// CSP.
		expect(html).not.toContain('<link rel="stylesheet"');
		expect(html).not.toContain('print-header');
		// Default document lang follows DEFAULT_LOCALE (en).
		expect(html).toContain('<html lang="en">');
	});

	it('passes the language to the standalone document', async () => {
		stubCssFetch();
		const inline = await buildStandaloneHtmlDocument('Export', '<p>x</p>', undefined, 'fr');
		expect(inline).toContain('<html lang="fr">');
	});

	it('inlines KaTeX CSS and font data URLs when math is present', async () => {
		stubCssFetch();
		const html = await buildStandaloneHtmlDocument('T', '<span class="katex">x</span>');
		expect(html).toContain('.katex{font-size:1.1em}');
		expect(html).toContain('url(data:font/woff2;base64,AAECAw==)');
		expect(html).not.toContain('url(fonts/KaTeX_Main.woff2)');
		expect(html).not.toMatch(/https?:\/\//);
		expect(html).not.toContain('<link');
	});

	it('embeds every supported KaTeX font format with a matching MIME type', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				if (url.includes('/katex/fonts/')) {
					return {
						ok: true,
						status: 200,
						arrayBuffer: async () => new Uint8Array([1]).buffer
					} as Response;
				}
				const body = url.includes('katex')
					? [
							'url(fonts/a.woff2)',
							'url(fonts/b.woff)',
							'url(fonts/c.ttf)',
							'url(fonts/d.otf)',
							'url(fonts/e.bin)'
						].join(' ')
					: '.print-body{}';
				return { ok: true, status: 200, text: async () => body } as Response;
			})
		);
		const html = await buildStandaloneHtmlDocument('T', '<span class="katex">x</span>');
		expect(html).toContain('data:font/woff2;base64,AQ==');
		expect(html).toContain('data:font/woff;base64,AQ==');
		expect(html).toContain('data:font/ttf;base64,AQ==');
		expect(html).toContain('data:font/otf;base64,AQ==');
		expect(html).toContain('data:application/octet-stream;base64,AQ==');
	});

	it('does not embed KaTeX without detected math', async () => {
		stubCssFetch();
		const html = await buildStandaloneHtmlDocument('T', '<p>texte</p>', 'texte');
		expect(html).not.toContain('.katex{');
	});

	it('keeps the restrictive script-src CSP', async () => {
		stubCssFetch();
		const html = await buildStandaloneHtmlDocument('T', '<p>x</p>');
		expect(html).toMatch(/script-src 'none'/);
	});

	it('escapes the title', async () => {
		stubCssFetch();
		const html = await buildStandaloneHtmlDocument('<b>Unsafe</b>', '');
		expect(html).toContain('&lt;b&gt;');
		expect(html).not.toContain('<title><b>Unsafe</b></title>');
	});

	it('fails when a required stylesheet cannot be embedded', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: false, status: 404, text: async () => '' }) as Response)
		);
		await expect(buildStandaloneHtmlDocument('T', '<p>x</p>')).rejects.toThrow(
			'CSS /print/print.css : HTTP 404'
		);
	});

	it('fails when a required font cannot be embedded', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				if (url.includes('/katex/fonts/')) {
					return {
						ok: false,
						status: 500,
						arrayBuffer: async () => new ArrayBuffer(0)
					} as Response;
				}
				const body = url.includes('katex')
					? '@font-face{src:url(fonts/KaTeX_Main.woff2)}'
					: '.print-body{}';
				return { ok: true, status: 200, text: async () => body } as Response;
			})
		);
		await expect(buildStandaloneHtmlDocument('T', '<span class="katex">x</span>')).rejects.toThrow(
			'Font /katex/fonts/KaTeX_Main.woff2: HTTP 500'
		);
	});
});

describe('printInIframe', () => {
	// Intercept document.createElement('iframe') to spy on print and focus.
	// Keep the real jsdom iframe and its writable contentDocument.
	let printSpy: Mock<() => void>;
	let focusSpy: Mock<() => void>;
	let lastIframe: HTMLIFrameElement | null;
	let restoreCreate: () => void;

	function patchCreateElement(opts: { onIframe?: (f: HTMLIFrameElement) => void } = {}) {
		const realCreate = document.createElement.bind(document);
		const mocked = (tag: string) => {
			const el = realCreate(tag);
			if (tag.toLowerCase() === 'iframe') {
				const iframe = el as HTMLIFrameElement;
				lastIframe = iframe;
				// Append the iframe before contentWindow exists. Add the spies through a contentWindow getter.
				opts.onIframe?.(iframe);
			}
			return el;
		};
		document.createElement = mocked as typeof document.createElement;
		restoreCreate = () => {
			document.createElement = realCreate as typeof document.createElement;
		};
	}

	/** Add print and focus spies to contentWindow after the iframe is attached. */
	function spyOnWindow(iframe: HTMLIFrameElement) {
		// contentWindow exists only after appendChild. Replace its getter to return an object with spies.
		Object.defineProperty(iframe, 'contentWindow', {
			configurable: true,
			get() {
				const realWin = Object.getOwnPropertyDescriptor(
					HTMLIFrameElement.prototype,
					'contentWindow'
				)?.get?.call(iframe) as Window | null;
				if (realWin) {
					(realWin as Window & { print: typeof printSpy }).print = printSpy;
					(realWin as Window & { focus: typeof focusSpy }).focus = focusSpy;
				}
				return realWin;
			}
		});
	}

	beforeEach(() => {
		printSpy = vi.fn();
		focusSpy = vi.fn();
		lastIframe = null;
	});

	afterEach(() => {
		restoreCreate?.();
		vi.useRealTimers();
		// Remove remaining iframes.
		document.querySelectorAll('iframe').forEach((f) => f.remove());
	});

	it('creates a hidden iframe, writes HTML, focuses, and prints', async () => {
		patchCreateElement({ onIframe: spyOnWindow });
		await printInIframe('<!doctype html><html><body><p>doc</p></body></html>');
		expect(lastIframe).not.toBeNull();
		expect(lastIframe?.getAttribute('aria-hidden')).toBe('true');
		expect(lastIframe?.style.visibility).toBe('hidden');
		expect(focusSpy).toHaveBeenCalledOnce();
		expect(printSpy).toHaveBeenCalledOnce();
		// The written content must be in contentDocument.
		expect(lastIframe?.contentDocument?.body.innerHTML).toContain('<p>doc</p>');
	});

	it('sets a localized accessible iframe title', async () => {
		patchCreateElement({ onIframe: spyOnWindow });
		await printInIframe('<html><body>x</body></html>');
		// Tests use the French locale by default.
		expect(lastIframe?.title).toBe('Aperçu d’impression');
	});

	it('removes the iframe from the DOM after afterprint', async () => {
		patchCreateElement({ onIframe: spyOnWindow });
		await printInIframe('<html><body>x</body></html>');
		const iframe = lastIframe!;
		expect(iframe.parentNode).not.toBeNull();
		// Simulate the end of printing.
		iframe.contentWindow?.dispatchEvent(new Event('afterprint'));
		expect(iframe.parentNode).toBeNull();
	});

	it('removes the iframe after the grace period without afterprint', async () => {
		vi.useFakeTimers();
		patchCreateElement({ onIframe: spyOnWindow });
		const p = printInIframe('<html><body>x</body></html>');
		// Advance the fake timers to resolve the microtasks and animation frame. Then await the promise.
		await vi.runAllTimersAsync();
		await p;
		const iframe = lastIframe!;
		// runAllTimersAsync already ran the cleanup timeout.
		expect(iframe.parentNode).toBeNull();
		vi.useRealTimers();
	});

	it('uses the load path when the document is incomplete', async () => {
		patchCreateElement({
			onIframe: (iframe) => {
				spyOnWindow(iframe);
				// Set readyState to a value other than 'complete' to exercise the load event branch.
				let fakeReady = 'loading';
				Object.defineProperty(iframe, 'contentDocument', {
					configurable: true,
					get() {
						const realDoc = Object.getOwnPropertyDescriptor(
							HTMLIFrameElement.prototype,
							'contentDocument'
						)?.get?.call(iframe) as Document | null;
						if (realDoc) {
							Object.defineProperty(realDoc, 'readyState', {
								configurable: true,
								get: () => fakeReady
							});
						}
						return realDoc;
					}
				});
				// Dispatch the load event shortly after to end the wait.
				setTimeout(() => {
					fakeReady = 'complete';
					iframe.dispatchEvent(new Event('load'));
				}, 0);
			}
		});
		await printInIframe('<html><body>x</body></html>');
		expect(printSpy).toHaveBeenCalledOnce();
	});

	it('waits for fonts.ready when FontFaceSet is available', async () => {
		const fontsReady = vi.fn(() => Promise.resolve());
		patchCreateElement({
			onIframe: (iframe) => {
				spyOnWindow(iframe);
				Object.defineProperty(iframe, 'contentDocument', {
					configurable: true,
					get() {
						const realDoc = Object.getOwnPropertyDescriptor(
							HTMLIFrameElement.prototype,
							'contentDocument'
						)?.get?.call(iframe) as Document | null;
						if (realDoc && !('fonts' in realDoc)) {
							Object.defineProperty(realDoc, 'fonts', {
								configurable: true,
								get: () => ({
									get ready() {
										return fontsReady();
									}
								})
							});
						}
						return realDoc;
					}
				});
			}
		});
		await printInIframe('<html><body>x</body></html>');
		expect(fontsReady).toHaveBeenCalled();
		expect(printSpy).toHaveBeenCalledOnce();
	});

	it('ignores a fonts.ready error', async () => {
		patchCreateElement({
			onIframe: (iframe) => {
				spyOnWindow(iframe);
				Object.defineProperty(iframe, 'contentDocument', {
					configurable: true,
					get() {
						const realDoc = Object.getOwnPropertyDescriptor(
							HTMLIFrameElement.prototype,
							'contentDocument'
						)?.get?.call(iframe) as Document | null;
						if (realDoc && !('fonts' in realDoc)) {
							Object.defineProperty(realDoc, 'fonts', {
								configurable: true,
								get: () => ({
									get ready() {
										return Promise.reject(new Error('fonts ko'));
									}
								})
							});
						}
						return realDoc;
					}
				});
			}
		});
		// The operation must resolve when fonts.ready fails.
		await expect(printInIframe('<html><body>x</body></html>')).resolves.toBeUndefined();
		expect(printSpy).toHaveBeenCalledOnce();
	});

	it('rejects and cleans up without contentDocument', async () => {
		patchCreateElement({
			onIframe: (iframe) => {
				Object.defineProperty(iframe, 'contentDocument', {
					configurable: true,
					get: () => null
				});
			}
		});
		await expect(printInIframe('<html></html>')).rejects.toThrow(/contentDocument/);
		// The catch block must remove the iframe from the DOM.
		expect(lastIframe?.parentNode).toBeNull();
	});

	it('rejects and cleans up without contentWindow', async () => {
		patchCreateElement({
			onIframe: (iframe) => {
				// contentDocument remains valid for writing, but contentWindow is null.
				Object.defineProperty(iframe, 'contentWindow', {
					configurable: true,
					get: () => null
				});
			}
		});
		await expect(printInIframe('<html><body>x</body></html>')).rejects.toThrow(/contentWindow/);
		expect(lastIframe?.parentNode).toBeNull();
	});
});

// In the SSR branch, assetUrl uses `${base}${path}` without window.
// printInIframe rejects immediately. Mock $app/environment with browser=false and import the module again.
describe('print.ts during server-side rendering', () => {
	afterEach(() => {
		vi.resetModules();
		vi.doUnmock('$app/environment');
	});

	it('rejects printInIframe when browser is false', async () => {
		vi.resetModules();
		vi.doMock('$app/environment', () => ({
			browser: false,
			dev: false,
			building: true,
			version: 'test'
		}));
		const mod = await import('./print');
		await expect(mod.printInIframe('<html></html>')).rejects.toThrow(/browser environment/);
	});

	it('uses relative asset URLs in buildPrintDocument without window', async () => {
		vi.resetModules();
		vi.doMock('$app/environment', () => ({
			browser: false,
			dev: false,
			building: true,
			version: 'test'
		}));
		const mod = await import('./print');
		const html = mod.buildPrintDocument({ title: 'T', bodyHtml: '<p>x</p>' });
		// In tests, base='' gives href="/print/print.css" without an absolute window.location URL.
		expect(html).toContain('href="/print/print.css"');
		expect(html).not.toContain('http://localhost');
	});
});

describe('bounded print preparation', () => {
	afterEach(() => vi.useRealTimers());

	it('rejects a canceled preparation without images', async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			waitForPrintImages(document.implementation.createHTMLDocument(), {
				signal: controller.signal
			})
		).rejects.toMatchObject({ name: 'AbortError' });
	});

	it('reports a missing source and a decoded image without height', async () => {
		const doc = document.implementation.createHTMLDocument();
		doc.body.innerHTML = '<img alt="Source absente"><img data-mdsh-remote-src="remote.png">';
		const image = doc.images[1]!;
		image.decode = vi.fn(async () => {});
		Object.defineProperty(image, 'naturalWidth', { value: 192 });
		await expect(waitForPrintImages(doc)).rejects.toMatchObject({
			sources: ['Source absente', 'remote.png']
		});
	});

	it('reuses only a complete image with two positive dimensions', async () => {
		const doc = document.implementation.createHTMLDocument();
		doc.body.innerHTML = '<img src="cached.png">';
		const image = doc.images[0]!;
		Object.defineProperties(image, {
			complete: { value: true },
			naturalWidth: { value: 192 },
			naturalHeight: { value: 192 }
		});
		image.decode = vi.fn();
		await waitForPrintImages(doc);
		expect(image.decode).not.toHaveBeenCalled();
	});

	it.each(['load', 'error'])(
		'traite un navigateur sans decode avec événement %s',
		async (event) => {
			const doc = document.implementation.createHTMLDocument();
			doc.body.innerHTML = '<img src="image.png">';
			const image = doc.images[0]!;
			Object.defineProperties(image, {
				naturalWidth: { value: 192 },
				naturalHeight: { value: 192 }
			});
			const pending = waitForPrintImages(doc);
			image.dispatchEvent(new Event(event));
			if (event === 'load') await expect(pending).resolves.toBeUndefined();
			else await expect(pending).rejects.toBeInstanceOf(PrintImageError);
		}
	);

	it('stops waiting for an image that never decodes', async () => {
		vi.useFakeTimers();
		const doc = document.implementation.createHTMLDocument();
		doc.body.innerHTML = '<img src="stalled.png">';
		doc.images[0]!.decode = () => new Promise(() => {});
		const assertion = expect(waitForPrintImages(doc, { timeoutMs: 30 })).rejects.toMatchObject({
			sources: ['stalled.png']
		});
		await vi.advanceTimersByTimeAsync(30);
		await assertion;
	});
});
