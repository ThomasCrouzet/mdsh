import { TIMERS } from '../config';
import { boundedWait, waitForPrintImages } from './print';
import { isMac } from '../platform';

// Prepare print media before WKWebView calculates native page boundaries.
// The shadow tree keeps the document styles separate from the application.
export async function printOnDesktop(
	html: string,
	opts: { signal?: AbortSignal } = {}
): Promise<boolean> {
	if (document.getElementById('mdsh-native-print')) throw new Error('Printing is already active');
	const parsed = new DOMParser().parseFromString(html, 'text/html');
	const host = document.createElement('section');
	host.id = 'mdsh-native-print';
	host.setAttribute('aria-hidden', 'true');
	const root = host.attachShadow({ mode: 'open' });
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
	if (isMac())
		layout.textContent += `
html[data-mdsh-printing] body > :not(#mdsh-native-print) { display: none !important; }
html[data-mdsh-printing], html[data-mdsh-printing] body { display: block !important; height: auto !important; overflow: visible !important; background: white !important; margin: 0 !important; }
html[data-mdsh-printing] #mdsh-native-print { display: block !important; position: static !important; width: 178mm !important; margin: 0 auto !important; }
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
		document.documentElement.removeAttribute('data-mdsh-printing');
		if (document.title === parsed.title) document.title = originalTitle;
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
			// Resolve relative font URLs from the original stylesheet directory.
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
				.map((css) => {
					const scoped = css.replace(/(^|[}\n,])\s*(?::root|html|body)(?=\s*[{,])/g, '$1:host');
					return isMac() ? scoped.replace(/@media print\s*\{/g, '@media all {') : scoped;
				})
				.join('\n');
		root.append(sheet);
		for (const child of Array.from(parsed.body.childNodes))
			root.append(document.importNode(child, true));
		document.head.append(layout);
		document.body.append(host);
		opts.signal?.addEventListener('abort', cleanup, { once: true });
		await waitForPrintImages(root, { signal: opts.signal });
		if (document.fonts) await boundedWait(document.fonts.ready, 10_000, opts.signal);
		if (isMac()) document.documentElement.setAttribute('data-mdsh-printing', '');
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		checkCancelled();
		if (!isMac()) document.title = parsed.title || originalTitle;
		if (isMac()) {
			const { invoke } = await import('@tauri-apps/api/core');
			try {
				return await invoke<boolean>('desktop_print', { title: parsed.title || originalTitle });
			} finally {
				cleanup();
			}
		} else {
			window.addEventListener('afterprint', cleanup, { once: true });
			cleanupTimer = setTimeout(cleanup, TIMERS.printIframeCleanupMs);
			window.print();
			return true;
		}
	} catch (error) {
		cleanup();
		throw error;
	}
}
