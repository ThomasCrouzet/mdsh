// Shared DOMPurify helpers for markdown HTML (reading / export / print)
// and the WYSIWYG Mermaid preview. Both paths must neutralize remote
// `style="... url(https://...)"` beacons (SECURITY.md).

export interface SanitizeNode {
	tagName?: string;
	hasAttribute?: (name: string) => boolean;
	getAttribute?: (name: string) => string | null;
	setAttribute?: (name: string, value: string) => void;
	removeAttribute?: (name: string) => void;
}

function normalizeCssForInspection(style: string): string | null {
	if (/\/\*[\s\S]*$/.test(style.replace(/\/\*[\s\S]*?\*\//g, ''))) return null;
	const withoutComments = style
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/\\(?:\r\n|\r|\n|\f)/g, '');
	const decoded = withoutComments.replace(
		/\\([0-9a-f]{1,6})(?:\s)?|\\([^\r\n\f])/gi,
		(_match, hex, escaped) => {
			if (hex) {
				const codePoint = Number.parseInt(hex, 16);
				return codePoint === 0 || codePoint > 0x10ffff ? '\uFFFD' : String.fromCodePoint(codePoint);
			}
			return escaped ?? '';
		}
	);
	return [...decoded]
		.filter((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return codePoint > 0x1f && codePoint !== 0x7f;
		})
		.join('')
		.toLowerCase();
}

function hasOnlyFragmentUrls(style: string): boolean {
	const normalized = normalizeCssForInspection(style);
	if (normalized === null) return false;
	if (/(?:^|[^a-z-])(?:-webkit-)?image-set\s*\(|(?:^|[^a-z-])(?:image|src)\s*\(/.test(normalized)) {
		return false;
	}
	let cursor = 0;
	while (cursor < normalized.length) {
		const start = normalized.indexOf('url', cursor);
		if (start === -1) return true;
		let open = start + 3;
		while (/\s/.test(normalized[open] ?? '')) open++;
		if (normalized[open] !== '(') {
			cursor = open;
			continue;
		}
		const close = normalized.indexOf(')', open + 1);
		if (close === -1) return false;
		let value = normalized.slice(open + 1, close).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1).trim();
		}
		if (!/^#[a-z_][a-z0-9_.:-]*$/i.test(value)) return false;
		cursor = close + 1;
	}
	return true;
}

/** Keeps CSS `url()` values only when every value is a local fragment. */
export function stripRemoteStyleUrls(style: string): string {
	return hasOnlyFragmentUrls(style) ? style : '';
}

/** Neutralizes remote `url()` beacons on a node's leftover `style` attribute. */
export function neutralizeRemoteStyleUrls(node: SanitizeNode): void {
	if (typeof node.getAttribute !== 'function' || !node.hasAttribute?.('style')) return;
	const style = node.getAttribute('style') ?? '';
	const cleaned = stripRemoteStyleUrls(style);
	if (cleaned === '') node.removeAttribute?.('style');
}

function isNetworkImageSource(value: string): boolean {
	const source = value.trim();
	return source !== '' && !/^(?:data:|blob:|#)/i.test(source);
}

/** Blocks network-capable image sources unless the caller records explicit consent. */
export function applyRemoteImagePolicy(html: string, allowRemoteImages: boolean): string {
	if (typeof document === 'undefined') return html;
	const template = document.createElement('template');
	template.innerHTML = html;

	for (const image of template.content.querySelectorAll('img')) {
		image.setAttribute('referrerpolicy', 'no-referrer');
		image.setAttribute('crossorigin', 'anonymous');
		const src = image.getAttribute('src');
		if (!allowRemoteImages && src && isNetworkImageSource(src)) {
			image.setAttribute('data-mdsh-remote-src', src);
			image.removeAttribute('src');
			image.classList.add('mdsh-remote-image-blocked');
		}
		const srcset = image.getAttribute('srcset');
		if (!allowRemoteImages && srcset) {
			image.setAttribute('data-mdsh-remote-srcset', srcset);
			image.removeAttribute('srcset');
			image.classList.add('mdsh-remote-image-blocked');
		}
	}

	for (const image of template.content.querySelectorAll('svg image')) {
		for (const attribute of ['href', 'xlink:href']) {
			const source = image.getAttribute(attribute);
			if (!allowRemoteImages && source && isNetworkImageSource(source)) {
				image.setAttribute(`data-mdsh-remote-${attribute.replace(':', '-')}`, source);
				image.removeAttribute(attribute);
				image.classList.add('mdsh-remote-image-blocked');
			}
		}
	}

	return template.innerHTML;
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
