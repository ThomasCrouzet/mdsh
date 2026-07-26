// Generation of a "print-ready" HTML document and opening of the print
// dialog via a hidden iframe - the user picks "Save as PDF".
// Loads the stylesheets from /static/ (KaTeX fonts + print stylesheet),
// respects BASE_PATH for GitHub Pages.

import { browser } from '$app/environment';
import { base } from '$app/paths';
import { escapeHTML } from '../file-utils';
import { TIMERS } from '../config';
import { hasMath } from './markdown';
import { t } from '$lib/i18n';
import { DEFAULT_LOCALE } from '$lib/i18n/locale';

export interface PrintDocumentOptions {
	title: string;
	bodyHtml: string;
	/** Raw markdown - used to decide whether to include the KaTeX CSS. */
	source?: string;
	/** Renders the title as the document header (default: true). */
	showHeader?: boolean;
	/**
	 * BCP 47 language tag for `<html lang>`. Defaults to the app default
	 * locale (English). Callers should pass the live UI locale (`i18n.locale`).
	 */
	lang?: string;
}

/** Normalizes an optional lang tag; empty/missing → DEFAULT_LOCALE. */
function resolveDocumentLang(lang?: string): string {
	const trimmed = lang?.trim();
	return trimmed ? trimmed : DEFAULT_LOCALE;
}

function assetUrl(path: string): string {
	if (!browser) return `${base}${path}`;
	return new URL(`${base}${path}`, window.location.href).href;
}

export function buildPrintDocument(opts: PrintDocumentOptions): string {
	const { title, bodyHtml, source, showHeader = true, lang } = opts;
	const safeTitle = escapeHTML(title);
	const safeLang = escapeHTML(resolveDocumentLang(lang));
	const needsKatex = source ? hasMath(source) : /class="math-block"|class="katex/.test(bodyHtml);

	const printCssUrl = assetUrl('/print/print.css');
	const katexCssUrl = assetUrl('/katex/katex.min.css');

	const katexLink = needsKatex ? `<link rel="stylesheet" href="${katexCssUrl}">\n` : '';

	const header = showHeader
		? `<header class="print-header"><p class="print-kicker">mdsh</p><h1>${safeTitle}</h1></header>\n`
		: '';

	return `<!doctype html>
<html lang="${safeLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob: https:; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; style-src 'self' 'unsafe-inline'">
<title>${safeTitle}</title>
<link rel="stylesheet" href="${printCssUrl}">
${katexLink}</head>
<body>
<main class="print-body">
${header}${bodyHtml}
</main>
</body>
</html>`;
}

/** Fetches the text of a stylesheet served by the app (for inlining). */
async function fetchCssText(path: string): Promise<string> {
	const res = await fetch(assetUrl(path));
	if (!res.ok) throw new Error(`CSS ${path} : HTTP ${res.status}`);
	return res.text();
}

/** Assembles the standalone document with the CSS INLINED into <style> tags. */
function renderStandaloneDoc(
	title: string,
	bodyHtml: string,
	styles: string[],
	lang?: string
): string {
	const safeTitle = escapeHTML(title);
	const safeLang = escapeHTML(resolveDocumentLang(lang));
	const styleTags = styles.map((css) => `<style>\n${css}\n</style>`).join('\n');
	return `<!doctype html>
<html lang="${safeLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob: https:; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; style-src 'self' 'unsafe-inline'; font-src 'self' https: data:">
<title>${safeTitle}</title>
${styleTags}
</head>
<body>
<main class="print-body">
${bodyHtml}
</main>
</body>
</html>`;
}

/**
 * Builds standalone HTML for the downloadable .html export.
 *
 * Unlike the PDF (iframe of the SAME origin as the app), the exported .html is
 * meant to be opened from disk (`file://`) or re-served elsewhere. Its CSP
 * enforces `style-src 'self' 'unsafe-inline'`: cross-origin <link> tags would
 * be BLOCKED there (the document's origin is no longer the app's). So we INLINE
 * print.css - and, if needed, katex.min.css - into <style> tags, which actually
 * keeps the "standalone" promise and works offline. The KaTeX fonts
 * (referenced as `url(fonts/…)` in katex.min.css) are rewritten as absolute
 * URLs to the app's origin: they load when the app is reachable and degrade
 * gracefully otherwise (the math layout stays correct).
 *
 * If fetching the CSS fails (offline export, app unreachable), we fall back to
 * the legacy <link>-based document - at least readable as long as the app is
 * served from the same origin.
 */
export async function buildStandaloneHtmlDocument(
	title: string,
	bodyHtml: string,
	source?: string,
	lang?: string
): Promise<string> {
	const needsKatex = source ? hasMath(source) : /class="math-block"|class="katex/.test(bodyHtml);
	try {
		const styles: string[] = [await fetchCssText('/print/print.css')];
		if (needsKatex) {
			let katexCss = await fetchCssText('/katex/katex.min.css');
			// Rewrites the relative fonts to the app's absolute URL (otherwise broken
			// as soon as the file leaves the /katex/ folder).
			const fontsBase = assetUrl('/katex/fonts/');
			katexCss = katexCss.replace(/url\((['"]?)fonts\//g, `url($1${fontsBase}`);
			styles.push(katexCss);
		}
		return renderStandaloneDoc(title, bodyHtml, styles, lang);
	} catch {
		// `source` omitted if undefined (exactOptionalPropertyTypes).
		return buildPrintDocument({
			title,
			bodyHtml,
			...(source !== undefined ? { source } : {}),
			...(lang !== undefined ? { lang } : {}),
			showHeader: false
		});
	}
}

/**
 * Opens a hidden iframe, writes the HTML into it, waits for assets to load
 * (KaTeX fonts, CSS, images), then triggers the native print dialog.
 *
 * The iframe is removed automatically after `afterprint` or after a 60 s grace
 * period (some browsers do not fire the event).
 */
export async function printInIframe(html: string): Promise<void> {
	if (!browser) throw new Error('printInIframe requires a browser environment');

	const iframe = document.createElement('iframe');
	iframe.setAttribute('aria-hidden', 'true');
	iframe.setAttribute('tabindex', '-1');
	iframe.title = t('print.iframeTitle');
	// Visually hidden but rendered - required for print() to work.
	iframe.style.cssText =
		'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;z-index:-1';
	document.body.appendChild(iframe);

	const cleanup = () => {
		if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
	};

	try {
		const doc = iframe.contentDocument;
		if (!doc) throw new Error('iframe contentDocument indisponible');

		doc.open();
		doc.write(html);
		doc.close();

		// Wait for the document to be "complete" - combines the two signals
		// (readyState + iframe load) with a timeout safety net.
		await new Promise<void>((resolve) => {
			let settled = false;
			let timer: ReturnType<typeof setTimeout> | null = null;
			const done = () => {
				if (settled) return;
				settled = true;
				if (timer) clearTimeout(timer);
				resolve();
			};
			if (iframe.contentDocument?.readyState === 'complete') {
				requestAnimationFrame(done);
				return;
			}
			iframe.addEventListener('load', done, { once: true });
			// Safety net: some browsers do not re-fire `load` after
			// `document.write()`; we unblock after 3 s no matter what.
			timer = setTimeout(done, TIMERS.printIframeLoadMs);
		});

		// Wait for the webfonts to load (KaTeX mostly).
		const idoc = iframe.contentDocument;
		if (idoc && 'fonts' in idoc) {
			try {
				await (idoc as Document & { fonts: FontFaceSet }).fonts.ready;
			} catch {
				/* ignore */
			}
		}

		// Allow one extra frame for the layout to stabilize.
		await new Promise((r) => requestAnimationFrame(() => r(undefined)));

		const win = iframe.contentWindow;
		if (!win) throw new Error('iframe contentWindow indisponible');

		// Cleanup after printing - afterprint or grace period.
		let removed = false;
		const removeOnce = () => {
			if (removed) return;
			removed = true;
			cleanup();
		};
		win.addEventListener('afterprint', removeOnce, { once: true });
		setTimeout(removeOnce, TIMERS.printIframeCleanupMs);

		win.focus();
		win.print();
	} catch (err) {
		cleanup();
		throw err;
	}
}
