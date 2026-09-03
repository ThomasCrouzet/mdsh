import { TIMERS } from '../config';
import { boundedWait, waitForPrintImages } from './print';

// WKWebView fournit l'impression sur la fenêtre principale. Le Shadow DOM
// isole les styles du document et la feuille externe masque l'interface au tirage.
export async function printOnDesktop(
	html: string,
	opts: { signal?: AbortSignal } = {}
): Promise<void> {
	if (document.getElementById('mdsh-native-print')) throw new Error('Printing is already active');
	const parsed = new DOMParser().parseFromString(html, 'text/html');
	const host = document.createElement('section');
	host.id = 'mdsh-native-print';
	host.setAttribute('aria-hidden', 'true');
	const shadow = host.attachShadow({ mode: 'open' });
	const layout = document.createElement('style');
	layout.textContent = `
@media screen { #mdsh-native-print { position: fixed; left: -100000px; top: 0; width: 21cm; pointer-events: none; } }
@media print {
	body > :not(#mdsh-native-print) { display: none !important; }
	html, body { display: block !important; height: auto !important; overflow: visible !important; background: white !important; margin: 0 !important; }
	#mdsh-native-print { display: block !important; position: static !important; width: auto !important; }
}
@page { size: A4; margin: 1.8cm 1.6cm 2.2cm; }
`;
	const originalTitle = document.title;
	let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
	let cleaned = false;
	const cleanup = () => {
		if (cleaned) return;
		cleaned = true;
		if (cleanupTimer) clearTimeout(cleanupTimer);
		window.removeEventListener('afterprint', cleanup);
		opts.signal?.removeEventListener('abort', cleanup);
		host.remove();
		layout.remove();
		document.title = originalTitle;
	};
	const checkCancelled = () => {
		if (opts.signal?.aborted) throw new DOMException('Printing cancelled', 'AbortError');
	};
	try {
		checkCancelled();
		const styles = Array.from(parsed.querySelectorAll('style'), (node) => node.textContent ?? '');
		for (const link of parsed.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')) {
			const url = new URL(link.href, window.location.href);
			if (
				url.protocol !== window.location.protocol ||
				url.host !== window.location.host ||
				!/\/(?:print|katex)\/[^?]+\.css$/.test(url.pathname)
			) {
				throw new Error('Unexpected print stylesheet');
			}
			const response = await fetch(url.href, { signal: opts.signal ?? null });
			if (!response.ok) throw new Error(`Print stylesheet: HTTP ${response.status}`);
			// Les polices relatives restent résolues depuis leur dossier d'origine.
			styles.push(
				(await response.text()).replace(
					/url\((['"]?)(fonts\/[^)'"\s]+)\1\)/g,
					(_match, quote: string, path: string) => `url(${quote}${new URL(path, url).href}${quote})`
				)
			);
		}
		const sheet = document.createElement('style');
		sheet.textContent =
			':host { all: initial; display: block; }\n' +
			styles
				.map((css) => css.replace(/(^|[}\n,])\s*(?::root|html|body)(?=\s*[{,])/g, '$1:host'))
				.join('\n');
		shadow.append(sheet);
		for (const child of Array.from(parsed.body.childNodes))
			shadow.append(document.importNode(child, true));
		document.head.append(layout);
		document.body.append(host);
		opts.signal?.addEventListener('abort', cleanup, { once: true });
		await waitForPrintImages(shadow, { signal: opts.signal });
		if (document.fonts) await boundedWait(document.fonts.ready, 10_000, opts.signal);
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		checkCancelled();
		document.title = parsed.title || originalTitle;
		window.addEventListener('afterprint', cleanup, { once: true });
		cleanupTimer = setTimeout(cleanup, TIMERS.printIframeCleanupMs);
		window.print();
	} catch (error) {
		cleanup();
		throw error;
	}
}
