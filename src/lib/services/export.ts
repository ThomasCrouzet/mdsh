// Export service - pure functions that turn a FileItem (or a list) into a
// download (.md / .html) or a print dialog (native PDF).
//
// Design: no dependency on the store. The functions neither mutate nor read
// the application state (no access to `filesStore`, no modification of `dirty`,
// no save scheduling). The store wraps these functions with its own
// side-effects (reset dirty, scheduleSave, spinner toast).
//
// Lazy-loading preserved: the rendering libs (`marked`, `katex`, `highlight.js`,
// `mermaid`, `dompurify`) remain dynamically imported inside the async
// functions so they do not fall into the initial bundle.
//
// Environment guard: all DOM-dependent functions check
// `typeof document !== 'undefined'` - useful in unit tests where the
// calling store cannot guarantee the context (jsdom OK, SSR no).

import type { FileItem } from '$lib/types';
import { stripMdExtension, untitledBasename, untitledFilename } from '$lib/file-utils';

/**
 * Sanitizes a filename for export: replaces characters forbidden on common
 * filesystems (`/ \ : * ? " < > |`) with `_`, to avoid a name like `a/b.md`
 * creating an unintended sub-tree in the ZIP or a broken `download` attribute
 * depending on the OS. Control characters are also neutralized. The file's
 * stored name is never modified - sanitization only happens at export time.
 *
 * Empty case (or containing only forbidden characters): fallback to the
 * live-locale untitled name (`files.untitledFilename`), preserving a possible
 * `.md` extension. An already valid name is returned as is (no regression).
 */
export function sanitizeFilename(name: string): string {
	// eslint-disable-next-line no-control-regex
	const cleaned = name.replace(/[/\\:*?"<>|\x00-\x1f]/g, '_');
	const trimmed = cleaned.trim();
	if (trimmed) return trimmed;
	// Empty name after sanitization: preserve the `.md` extension if present.
	return name.toLowerCase().endsWith('.md') ? untitledFilename() : untitledBasename();
}

/**
 * Triggers a file save. On the Tauri desktop shell, uses a native save dialog +
 * Rust write (WebView `<a download>` is unreliable across OS webviews). In the
 * browser, falls back to a blob + `<a download>` click.
 *
 * @returns `true` when a download/save was initiated; `false` when the user
 * cancelled the desktop save dialog (callers must NOT clear dirty or toast success).
 */
async function triggerDownload(blob: Blob, filename: string): Promise<boolean> {
	try {
		const { isDesktop } = await import('../desktop');
		if (isDesktop()) {
			const { tauriSaveExportBlob } = await import('../disk-tauri');
			// Cancel is an intentional no-op - do not fall through to blob download.
			return await tauriSaveExportBlob(blob, filename);
		}
	} catch {
		// Desktop path failed - fall through to browser download when possible.
	}
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
	return true;
}

/**
 * Downloads the raw markdown under the file's name (`<name>.md`).
 * @returns `false` if the desktop save dialog was cancelled.
 */
export async function exportMarkdown(file: FileItem): Promise<boolean> {
	if (typeof document === 'undefined') return false;
	const blob = new Blob([file.content], { type: 'text/markdown;charset=utf-8' });
	// Sanitization at export time only: a name containing `/`, `:`, etc. would
	// break the `download` attribute or create a sub-tree.
	return triggerDownload(blob, sanitizeFilename(file.name));
}

/**
 * Downloads a standalone HTML document rendered from the markdown.
 * Async because the renderer (marked + KaTeX + highlight.js + DOMPurify) is lazy-loaded.
 *
 * The HTML / window title uses the front-matter `title` if present (otherwise
 * the filename) - consistent with the sidebar UI and the PDF export.
 */
/** @returns `false` if the desktop save dialog was cancelled. */
export async function exportHTML(file: FileItem): Promise<boolean> {
	if (typeof document === 'undefined') return false;
	const [{ renderMarkdownDetailed }, { buildStandaloneHtmlDocument }, { i18n }] = await Promise.all(
		[import('../render/markdown'), import('../render/print'), import('$lib/i18n')]
	);
	const fallback = stripMdExtension(file.name);
	const { html: bodyHtml, title } = await renderMarkdownDetailed(file.content);
	const docTitle = title || fallback;
	const html = await buildStandaloneHtmlDocument(docTitle, bodyHtml, file.content, i18n.locale);
	const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
	// Same sanitization as markdown/ZIP exports - path-like names break download.
	return triggerDownload(blob, sanitizeFilename(fallback + '.html'));
}

/**
 * Builds a print-ready document and opens the native print dialog
 * (the user picks "Save as PDF").
 * Async because the renderer and the print iframe are lazy-loaded.
 *
 * The filename-derived title is metadata only. The printable body contains
 * exactly the rendered Markdown content, without generated branding, title,
 * filename or front matter.
 */
export async function exportPDF(file: FileItem): Promise<void> {
	if (typeof document === 'undefined') return;
	const [{ renderMarkdownDetailed }, { buildPrintDocument, printInIframe }, { i18n }] =
		await Promise.all([
			import('../render/markdown'),
			import('../render/print'),
			import('$lib/i18n')
		]);
	const fallback = stripMdExtension(file.name);
	const { html: bodyHtml, title } = await renderMarkdownDetailed(file.content, {
		showFrontmatter: false
	});
	const docTitle = title || fallback;
	const html = buildPrintDocument({
		title: docTitle,
		bodyHtml,
		source: file.content,
		lang: i18n.locale
	});
	await printInIframe(html);
}

/**
 * Creates and downloads a ZIP containing all the files passed as arguments.
 *
 * Why: a single download = no multi-file browser prompt (otherwise Chrome,
 * Edge, Safari show a "This site wants to download multiple files" banner as
 * soon as N >= 2). Also faster: no 120 ms setTimeout between each download.
 *
 * `jszip` is lazy-loaded via `await import(...)` inside the function - it never
 * falls into the initial bundle, only when the user exports everything.
 * Cost: ~30 KB gzipped.
 *
 * Guarantees name uniqueness within the zip: two files named "Untitled.md"
 * would otherwise collide (JSZip silently overwrites the first entry). We
 * suffix `-2`, `-3`, … while preserving the extension.
 */
/** @returns `false` if the desktop save dialog was cancelled. */
export async function exportZip(files: FileItem[], filename = 'mdsh-export.zip'): Promise<boolean> {
	if (typeof window === 'undefined' || typeof document === 'undefined' || files.length === 0)
		return false;
	const { default: JSZip } = await import('jszip');
	const zip = new JSZip();
	const used = new Set<string>();
	for (const f of files) {
		// Sanitize BEFORE deduplication: uniqueness (`-2`, `-3`…) thus operates
		// on already-safe names (otherwise an `a/b.md` would create a nested
		// entry in the ZIP instead of a flat file).
		let name = sanitizeFilename(f.name);
		if (used.has(name)) {
			const ext = name.match(/\.[^.]+$/)?.[0] ?? '';
			const base = ext ? name.slice(0, -ext.length) : name;
			let i = 2;
			while (used.has(`${base}-${i}${ext}`)) i++;
			name = `${base}-${i}${ext}`;
		}
		used.add(name);
		zip.file(name, f.content);
	}
	const blob = await zip.generateAsync({ type: 'blob' });
	return triggerDownload(blob, filename);
}
