import { describe, it, expect, vi, afterEach, beforeEach, type Mock } from 'vitest';
import { buildPrintDocument, buildStandaloneHtmlDocument, printInIframe } from './print';

describe('buildPrintDocument - structure', () => {
	it('produit un doctype HTML5 avec lang par défaut (en)', () => {
		const html = buildPrintDocument({ title: 'Doc', bodyHtml: '<p>hello</p>' });
		expect(html.startsWith('<!doctype html>')).toBe(true);
		// DEFAULT_LOCALE is English - not hardcoded French.
		expect(html).toContain('<html lang="en">');
	});

	it('honore lang explicite (en / fr)', () => {
		expect(buildPrintDocument({ title: 'T', bodyHtml: '', lang: 'fr' })).toContain(
			'<html lang="fr">'
		);
		expect(buildPrintDocument({ title: 'T', bodyHtml: '', lang: 'en' })).toContain(
			'<html lang="en">'
		);
	});

	it('retombe sur en si lang vide ou blanc', () => {
		expect(buildPrintDocument({ title: 'T', bodyHtml: '', lang: '   ' })).toContain(
			'<html lang="en">'
		);
	});

	it('inclut le titre dans <title> et dans le header par défaut', () => {
		const html = buildPrintDocument({ title: 'Mon document', bodyHtml: '<p>x</p>' });
		expect(html).toContain('<title>Mon document</title>');
		expect(html).toContain('<h1>Mon document</h1>');
		expect(html).toContain('class="print-kicker">mdsh');
	});

	it('omet le header quand showHeader=false', () => {
		const html = buildPrintDocument({
			title: 'Sans header',
			bodyHtml: '<p>body</p>',
			showHeader: false
		});
		expect(html).toContain('<title>Sans header</title>');
		expect(html).not.toContain('print-header');
		expect(html).not.toContain('print-kicker');
	});

	it('insère le body dans <main class="print-body">', () => {
		const html = buildPrintDocument({ title: 'T', bodyHtml: '<article>contenu</article>' });
		expect(html).toMatch(/<main class="print-body">[\s\S]*<article>contenu<\/article>/);
	});
});

describe('buildPrintDocument - sécurité', () => {
	it('échappe les < > & dans le titre', () => {
		const html = buildPrintDocument({
			title: '<script>alert(1)</script> & "quoted"',
			bodyHtml: ''
		});
		expect(html).not.toContain('<script>alert(1)</script>');
		expect(html).toContain('&lt;script&gt;');
		expect(html).toContain('&amp;');
		expect(html).toContain('&quot;');
	});

	it('inclut une CSP restrictive interdisant le script', () => {
		const html = buildPrintDocument({ title: 'T', bodyHtml: '' });
		expect(html).toMatch(/http-equiv="Content-Security-Policy"/i);
		expect(html).toMatch(/script-src 'none'/);
		expect(html).toMatch(/object-src 'none'/);
		expect(html).toMatch(/form-action 'none'/);
	});
});

describe('buildPrintDocument - KaTeX conditionnel', () => {
	it('inclut le lien katex.min.css quand le source contient du math', () => {
		const html = buildPrintDocument({
			title: 'T',
			bodyHtml: '<p>rendered math</p>',
			source: 'Soit $a^2$'
		});
		expect(html).toContain('katex/katex.min.css');
	});

	it('inclut le lien katex.min.css quand le body contient une classe katex', () => {
		const html = buildPrintDocument({
			title: 'T',
			bodyHtml: '<span class="katex">x</span>'
		});
		expect(html).toContain('katex/katex.min.css');
	});

	it('inclut le lien katex quand le body contient math-block', () => {
		const html = buildPrintDocument({
			title: 'T',
			bodyHtml: '<div class="math-block">…</div>'
		});
		expect(html).toContain('katex/katex.min.css');
	});

	it("n'inclut pas katex.min.css quand aucun math n'est détecté", () => {
		const html = buildPrintDocument({
			title: 'T',
			bodyHtml: '<p>juste du texte</p>',
			source: 'juste du texte'
		});
		expect(html).not.toContain('katex/katex.min.css');
	});

	it('inclut toujours print.css', () => {
		const html = buildPrintDocument({ title: 'T', bodyHtml: '' });
		expect(html).toContain('print/print.css');
	});
});

describe('buildStandaloneHtmlDocument', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	/** Mock `fetch` renvoyant un texte CSS distinct selon l'URL demandée. */
	function stubCssFetch() {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				const body = url.includes('katex')
					? '.katex{font-size:1.1em}@font-face{src:url(fonts/KaTeX_Main.woff2)}'
					: '.print-body{color:#111}';
				return { ok: true, status: 200, text: async () => body } as Response;
			})
		);
	}

	it('INLINE print.css dans un <style> (pas de <link>) et insère le corps', async () => {
		stubCssFetch();
		const html = await buildStandaloneHtmlDocument('Export', '<p>corps</p>');
		expect(html).toContain('<title>Export</title>');
		expect(html).toContain('<p>corps</p>');
		expect(html).toContain('<style>');
		expect(html).toContain('.print-body{color:#111}');
		// Plus aucun <link rel=stylesheet> : c'est tout l'intérêt (CSP file://).
		expect(html).not.toContain('<link rel="stylesheet"');
		expect(html).not.toContain('print-header');
		// Default document lang follows DEFAULT_LOCALE (en).
		expect(html).toContain('<html lang="en">');
	});

	it('propage lang au document standalone et au repli <link>', async () => {
		stubCssFetch();
		const inline = await buildStandaloneHtmlDocument('Export', '<p>x</p>', undefined, 'fr');
		expect(inline).toContain('<html lang="fr">');

		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: false, status: 404, text: async () => '' }) as Response)
		);
		const fallback = await buildStandaloneHtmlDocument('T', '<p>x</p>', undefined, 'fr');
		expect(fallback).toContain('<html lang="fr">');
		expect(fallback).toContain('print/print.css');
	});

	it('inline katex.min.css et réécrit les fonts en URL absolue quand math présent', async () => {
		stubCssFetch();
		const html = await buildStandaloneHtmlDocument('T', '<span class="katex">x</span>');
		expect(html).toContain('.katex{font-size:1.1em}');
		// url(fonts/…) relatif réécrit en url(http…/katex/fonts/…)
		expect(html).toMatch(/url\(https?:\/\/[^)]*\/katex\/fonts\/KaTeX_Main\.woff2\)/);
		expect(html).not.toContain('url(fonts/KaTeX_Main.woff2)');
	});

	it("n'inline pas katex quand aucun math n'est détecté", async () => {
		stubCssFetch();
		const html = await buildStandaloneHtmlDocument('T', '<p>texte</p>', 'texte');
		expect(html).not.toContain('.katex{');
	});

	it('préserve la CSP restrictive (script-src none)', async () => {
		stubCssFetch();
		const html = await buildStandaloneHtmlDocument('T', '<p>x</p>');
		expect(html).toMatch(/script-src 'none'/);
	});

	it('échappe le titre', async () => {
		stubCssFetch();
		const html = await buildStandaloneHtmlDocument('<b>Unsafe</b>', '');
		expect(html).toContain('&lt;b&gt;');
		expect(html).not.toContain('<title><b>Unsafe</b></title>');
	});

	it('retombe sur le document à <link> si la récupération CSS échoue', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: false, status: 404, text: async () => '' }) as Response)
		);
		const html = await buildStandaloneHtmlDocument('T', '<p>x</p>');
		// Repli = buildPrintDocument sans header → <link> vers print.css
		expect(html).toContain('print/print.css');
		expect(html).toMatch(/script-src 'none'/);
	});

	it('propage le source au repli (branche source defined) et inclut katex si math', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: false, status: 500, text: async () => '' }) as Response)
		);
		// source contient du math → le repli buildPrintDocument doit inclure katex.
		const html = await buildStandaloneHtmlDocument('T', '<p>rendered</p>', 'Soit $a^2$');
		expect(html).toContain('print/print.css');
		expect(html).toContain('katex/katex.min.css');
		// Repli = showHeader:false (pas de print-header).
		expect(html).not.toContain('print-header');
	});
});

describe('printInIframe', () => {
	// Intercepte document.createElement('iframe') pour espionner le
	// contentWindow (print/focus) de l'iframe réelle créée par jsdom, tout en
	// laissant le vrai iframe (avec son contentDocument scriptable) intact.
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
				// L'iframe doit être appended avant que contentWindow existe ; on
				// applique les spies à la volée via un getter sur contentWindow.
				opts.onIframe?.(iframe);
			}
			return el;
		};
		document.createElement = mocked as typeof document.createElement;
		restoreCreate = () => {
			document.createElement = realCreate as typeof document.createElement;
		};
	}

	/** Installe les spies print/focus sur le contentWindow une fois l'iframe attachée. */
	function spyOnWindow(iframe: HTMLIFrameElement) {
		// contentWindow n'existe qu'après appendChild ; on patche après coup via
		// un microtask déclenché par l'appendChild interne. Plus simple : on
		// remplace le getter pour retourner un objet enrichi.
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
		// Nettoie les iframes résiduelles.
		document.querySelectorAll('iframe').forEach((f) => f.remove());
	});

	it('crée une iframe cachée, écrit le HTML, appelle focus() puis print()', async () => {
		patchCreateElement({ onIframe: spyOnWindow });
		await printInIframe('<!doctype html><html><body><p>doc</p></body></html>');
		expect(lastIframe).not.toBeNull();
		expect(lastIframe?.getAttribute('aria-hidden')).toBe('true');
		expect(lastIframe?.style.visibility).toBe('hidden');
		expect(focusSpy).toHaveBeenCalledOnce();
		expect(printSpy).toHaveBeenCalledOnce();
		// Le contenu écrit doit se retrouver dans le contentDocument.
		expect(lastIframe?.contentDocument?.body.innerHTML).toContain('<p>doc</p>');
	});

	it("définit un titre d'iframe accessible (i18n fr)", async () => {
		patchCreateElement({ onIframe: spyOnWindow });
		await printInIframe('<html><body>x</body></html>');
		// Locale fr par défaut dans les tests.
		expect(lastIframe?.title).toBe('Aperçu d’impression');
	});

	it('retire l’iframe du DOM à la réception de afterprint', async () => {
		patchCreateElement({ onIframe: spyOnWindow });
		await printInIframe('<html><body>x</body></html>');
		const iframe = lastIframe!;
		expect(iframe.parentNode).not.toBeNull();
		// Simule la fin d'impression.
		iframe.contentWindow?.dispatchEvent(new Event('afterprint'));
		expect(iframe.parentNode).toBeNull();
	});

	it('retire l’iframe après le délai de grâce si afterprint ne se déclenche pas', async () => {
		vi.useFakeTimers();
		patchCreateElement({ onIframe: spyOnWindow });
		const p = printInIframe('<html><body>x</body></html>');
		// Laisse les microtasks + rAF se résoudre malgré les fake timers : on
		// avance le temps puis on attend la promesse.
		await vi.runAllTimersAsync();
		await p;
		const iframe = lastIframe!;
		// Le setTimeout(cleanup) a déjà été exécuté par runAllTimersAsync.
		expect(iframe.parentNode).toBeNull();
		vi.useRealTimers();
	});

	it('emprunte le chemin "load" quand le document n’est pas encore complete', async () => {
		patchCreateElement({
			onIframe: (iframe) => {
				spyOnWindow(iframe);
				// Force readyState !== 'complete' pour emprunter la branche addEventListener('load').
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
				// Déclenche l'event load peu après pour débloquer l'attente.
				setTimeout(() => {
					fakeReady = 'complete';
					iframe.dispatchEvent(new Event('load'));
				}, 0);
			}
		});
		await printInIframe('<html><body>x</body></html>');
		expect(printSpy).toHaveBeenCalledOnce();
	});

	it('attend fonts.ready quand l’API FontFaceSet est présente', async () => {
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

	it('ignore une erreur de fonts.ready (catch silencieux)', async () => {
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
		// Ne doit PAS rejeter malgré l'échec de fonts.ready.
		await expect(printInIframe('<html><body>x</body></html>')).resolves.toBeUndefined();
		expect(printSpy).toHaveBeenCalledOnce();
	});

	it('rejette et nettoie si contentDocument est indisponible', async () => {
		patchCreateElement({
			onIframe: (iframe) => {
				Object.defineProperty(iframe, 'contentDocument', {
					configurable: true,
					get: () => null
				});
			}
		});
		await expect(printInIframe('<html></html>')).rejects.toThrow(/contentDocument/);
		// L'iframe doit avoir été retirée du DOM (cleanup dans le catch).
		expect(lastIframe?.parentNode).toBeNull();
	});

	it('rejette et nettoie si contentWindow est indisponible', async () => {
		patchCreateElement({
			onIframe: (iframe) => {
				// contentDocument reste valide (écriture OK) mais contentWindow = null.
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

// Branche SSR (browser=false) : assetUrl utilise `${base}${path}` sans window,
// et printInIframe rejette d'emblée. On remocke $app/environment avec
// browser=false puis on réimporte le module isolément.
describe('print.ts en contexte non-browser (SSR)', () => {
	afterEach(() => {
		vi.resetModules();
		vi.doUnmock('$app/environment');
	});

	it('printInIframe rejette si browser=false', async () => {
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

	it('buildPrintDocument utilise des URLs relatives (assetUrl sans window)', async () => {
		vi.resetModules();
		vi.doMock('$app/environment', () => ({
			browser: false,
			dev: false,
			building: true,
			version: 'test'
		}));
		const mod = await import('./print');
		const html = mod.buildPrintDocument({ title: 'T', bodyHtml: '<p>x</p>' });
		// base='' en test → href="/print/print.css" (pas d'URL absolue window.location).
		expect(html).toContain('href="/print/print.css"');
		expect(html).not.toContain('http://localhost');
	});
});
