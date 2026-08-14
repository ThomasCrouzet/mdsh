// Shared DOMPurify helpers for markdown HTML (reading / export / print)
// and the WYSIWYG Mermaid preview. Both paths must neutralize remote
// `style="... url(https://...)"` beacons (SECURITY.md).

export interface SanitizeNode {
	tagName?: string;
	hasAttribute?: (name: string) => boolean;
	getAttribute?: (name: string) => string | null;
	setAttribute?: (name: string, value: string) => void;
}

/** Strips remote http(s) / protocol-relative `url()` values from a CSS style string. */
export function stripRemoteStyleUrls(style: string): string {
	return style.replace(/url\(\s*(['"]?)\s*(?:https?:)?\/\/[^)]*\)/gi, '');
}

/** Neutralizes remote `url()` beacons on a node's leftover `style` attribute. */
export function neutralizeRemoteStyleUrls(node: SanitizeNode): void {
	if (typeof node.getAttribute !== 'function' || !node.hasAttribute?.('style')) return;
	const style = node.getAttribute('style') ?? '';
	if (!/url\(/i.test(style)) return;
	const cleaned = stripRemoteStyleUrls(style);
	if (cleaned !== style) node.setAttribute?.('style', cleaned);
}

/** Forces `target=_blank` + `rel=noopener noreferrer` on external http(s) links. */
export function hardenExternalLink(node: SanitizeNode): void {
	if (node.tagName !== 'A' || !node.hasAttribute?.('href')) return;
	const href = node.getAttribute?.('href') ?? '';
	if (/^https?:/i.test(href)) {
		node.setAttribute?.('target', '_blank');
		node.setAttribute?.('rel', 'noopener noreferrer');
	}
}

let hookRegistered = false;

/** Registers the shared afterSanitizeAttributes hook once per DOMPurify instance. */
export function registerMdshDomPurifyHooks(purify: {
	addHook: (
		entryPoint: 'afterSanitizeAttributes',
		hookFunction: (node: SanitizeNode) => void
	) => void;
}): void {
	if (hookRegistered) return;
	purify.addHook('afterSanitizeAttributes', (node) => {
		hardenExternalLink(node);
		neutralizeRemoteStyleUrls(node);
	});
	hookRegistered = true;
}

export interface SanitizeHtmlConfig {
	USE_PROFILES?: { html?: boolean; svg?: boolean; svgFilters?: boolean; mathMl?: boolean };
	ADD_ATTR?: string[];
	ADD_TAGS?: string[];
	FORBID_TAGS?: string[];
	FORBID_ATTR?: string[];
}

/** DOMPurify config for the WYSIWYG Mermaid preview (SVG + foreignObject). */
export const MERMAID_PREVIEW_PURIFY: SanitizeHtmlConfig = {
	USE_PROFILES: { html: true, svg: true, svgFilters: true },
	ADD_TAGS: ['foreignObject'],
	ADD_ATTR: ['target']
};

/** DOMPurify config for marked → HTML (reading / export). */
export const MARKDOWN_PURIFY: SanitizeHtmlConfig = {
	USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
	ADD_ATTR: ['target', 'data-mdsh-wiki'],
	FORBID_TAGS: ['style', 'form'],
	FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur']
};

export async function sanitizeHtml(html: string, config: SanitizeHtmlConfig): Promise<string> {
	const { default: DOMPurify } = await import('dompurify');
	registerMdshDomPurifyHooks(DOMPurify);
	return DOMPurify.sanitize(html, config) as string;
}

/** Sanitizer used by the WYSIWYG Mermaid preview (same remote url() hook as read). */
export function sanitizeMermaidPreviewHtml(html: string): Promise<string> {
	return sanitizeHtml(html, MERMAID_PREVIEW_PURIFY);
}
