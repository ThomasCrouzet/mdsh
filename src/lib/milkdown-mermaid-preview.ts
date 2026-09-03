// Mermaid live-preview for Milkdown Crepe.
//
// We hook the `renderPreview` of the CodeMirror feature exposed by Crepe
// (cf. node_modules/@milkdown/components/src/code-block/config.ts) - it is the
// official API to display a preview panel above a code block in the WYSIWYG
// editor. Latex already uses this hook (cf. lib/esm/feature/latex/index.js); we
// follow the same pattern for the `mermaid` language. When our function is
// called and the language is not `mermaid` we return `null` (no preview,
// default behavior), otherwise we kick off an async render via `applyPreview`.
//
// Lazy-load: the `mermaid` module (~3 MB minified) is only imported on the
// first render of a mermaid block. As long as the user does not write a
// diagram, mermaid never crosses the editor bundle.

import { browser } from '$app/environment';
import { escapeHTML } from './file-utils';
import { mermaidThemeFromDataTheme } from './theme';
import { t } from '$lib/i18n';
import { sanitizeMermaidPreviewHtml, renderMermaidSvg } from './render/sanitize-html';

// Global counter to generate unique IDs on the Mermaid side. Mermaid stores
// internal references by ID in the produced SVG; two SVGs coexisting in the DOM
// with the same ID would corrupt the arrows (internal linkages).
let counter = 0;

/**
 * Builds a stable signature of (language, code) to discard stale renders.
 * `renderPreview` is called on every keystroke when the user edits a block -
 * without invalidation we would accumulate concurrent mermaid renders.
 */
function makeToken(language: string, content: string): string {
	return `${language}::${content}`;
}

/**
 * Async render of a mermaid block → SVG injected into the preview panel of the
 * Milkdown code-block. On every keystroke a new token is generated; stale
 * promises (token != lastTokens.get(applyPreview)) are ignored.
 *
 * The token is stored by `applyPreview` (one per Mermaid block in the editor)
 * via WeakMap: without it, a module-global `lastToken` would make editing block
 * B cancel the ongoing render of block A - each block would stay silent until
 * the user re-touches it.
 *
 * Return value conforms to the `CodeBlockConfig.renderPreview` contract:
 * - `null`: no preview for this language (Milkdown hides the panel)
 * - `undefined` (implicit): async preview; we call `applyPreview()` later
 * - `string` / `HTMLElement`: synchronous preview (not used here)
 */
type ApplyPreview = (value: null | string | HTMLElement) => void;
const lastTokens = new WeakMap<ApplyPreview, string>();

export function renderMermaidPreview(
	language: string,
	content: string,
	applyPreview: ApplyPreview
): void | null {
	if (language.toLowerCase() !== 'mermaid') return null;
	const trimmed = content.trim();
	if (trimmed.length === 0) return null;

	if (!browser) return null;

	const token = makeToken(language, content);
	lastTokens.set(applyPreview, token);

	void renderToSvg(trimmed)
		.then((html) => {
			// Stale render (typing in progress on THIS block): discard it to
			// avoid replacing a more recent render with an older one.
			if (lastTokens.get(applyPreview) !== token) return;
			applyPreview(html);
		})
		.catch((err: unknown) => {
			if (lastTokens.get(applyPreview) !== token) return;
			const msg = err instanceof Error ? err.message : String(err);
			applyPreview(buildErrorBlock(msg, trimmed));
		});

	// Returning `undefined` = async preview (Milkdown will show previewLoading
	// while the promise resolves).
	return undefined;
}

/** Re-export so tests drive the same function the preview uses. */
export { sanitizeMermaidPreviewHtml as sanitizePreviewHtml } from './render/sanitize-html';

async function renderToSvg(code: string): Promise<string> {
	try {
		const id = `mdsh-wysiwyg-mermaid-${++counter}`;
		const theme = mermaidThemeFromDataTheme(document.documentElement.getAttribute('data-theme'));
		const svg = await renderMermaidSvg(id, code, theme);
		// We wrap the SVG in a container so we can style it and ensure an
		// auto overflow on wide diagrams.
		const wrapped = `<div class="mdsh-mermaid-svg">${svg}</div>`;
		return await sanitizeMermaidPreviewHtml(wrapped);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return buildErrorBlock(msg, code);
	}
}

function buildErrorBlock(message: string, code: string): string {
	return `<div class="mdsh-mermaid-preview-error" role="alert"><strong>${escapeHTML(t('read.mermaidError'))}</strong><pre>${escapeHTML(message)}</pre><pre class="mdsh-mermaid-preview-error-source">${escapeHTML(code)}</pre></div>`;
}
