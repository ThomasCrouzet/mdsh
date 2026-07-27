// Obsidian / Logseq style wiki-links: `[[File name]]`, `[[id-uuid]]`,
// `[[Name|displayed alias]]`. Lets you navigate between mdsh files without
// depending on the store on the renderer side (routing is delegated to the
// component that displays the HTML: ReadView intercepts the click and calls
// `filesStore.setActive` or creates the missing file - cf. ReadView.svelte).
//
// The module stays pure (zero store dependency, zero DOM) to remain lazy-load
// friendly and easily testable.

import { escapeHTML } from './file-utils';

/**
 * ASCII-friendly slugify of a name: lowercase + strips diacritics + replaces
 * every non-alphanumeric character with `-`. Used to generate the
 * `#mdsh-wiki-{slug}` ids placed on the `<a>` tags; does NOT need to be
 * reversible (the actual resolution happens via `data-mdsh-wiki`, which holds
 * the raw name).
 */
export function slugify(s: string): string {
	return s
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/(^-|-$)/g, '');
}

/**
 * Escapes a string for insertion into a regex (for backlink search, for
 * example - where the name contains special characters).
 */
export function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Pre-process: transforms `[[Target]]` and `[[Target|alias]]` into an HTML link.
 * Called BEFORE marked to guarantee stable behavior (custom marked extensions
 * interact badly with other extensions and GFM inline tokens).
 *
 * The produced HTML:
 *   <a href="#mdsh-wiki-{slug}" data-mdsh-wiki="{encoded-target}" class="wiki-link">{label}</a>
 *
 * - `href`: internal anchor (never followed; the clickable component
 *   `e.preventDefault()`s and delegates to the store).
 * - `data-mdsh-wiki`: raw name encoded via `encodeURIComponent` for exact
 *   resolution by file name or file id - prevents DOMPurify / XSS filters from
 *   stripping the attribute when the value contains HTML-looking characters
 *   (e.g. `[[<weird>]]`). The reader side (ReadView) decodes via
 *   `decodeWikiTarget`.
 * - `class="wiki-link"`: CSS hook + selector for the click handler.
 *
 * The label is HTML-escaped to avoid any injection if the name contains HTML
 * characters (e.g. `[[<script>]]`).
 */
export function preprocessWikiLinks(md: string): string {
	// Alternating scanner: we first capture a CODE region (fence
	// ```/~~~ or `…` span), left INTACT, OR a wiki-link, transformed. Without
	// this, a `[[x]]` inside a code block was converted into a link - inconsistent
	// with the WYSIWYG editor, which keeps it literal.
	//
	// The wiki-link sub-pattern keeps its classes excluding `[` (`[^[\]|\n]`):
	// on an unclosed input like `[[a|[[a|…`, the alias would otherwise swallow the
	// following `[[` while looking for `]]` → quadratic backtracking (ReDoS). The
	// code alternatives are linear (literal terminator). Cf. security-redos.test.
	const scanner =
		/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)|\[\[([^[\]|\n]+?)(?:\|([^[\]\n]+?))?\]\]/g;
	return md.replace(scanner, (match, code: string | undefined, target?: string, alias?: string) => {
		if (code !== undefined) return code; // code region: intact
		const cleanTarget = (target ?? '').trim();
		const label = (alias ?? cleanTarget).trim();
		if (!cleanTarget) return match;
		const slug = slugify(cleanTarget);
		// `encodeURIComponent` makes the target "DOMPurify-safe" (no < > &) while
		// staying round-trippable. On the click handler side: decode via
		// `decodeWikiTarget` to recover the raw value.
		const encoded = encodeURIComponent(cleanTarget);
		return `<a href="#mdsh-wiki-${slug}" data-mdsh-wiki="${encoded}" class="wiki-link">${escapeHTML(label)}</a>`;
	});
}

/**
 * Decodes a wiki-link target read from `data-mdsh-wiki`. Inverse of the
 * encoding done in `preprocessWikiLinks`. Tolerant: returns the raw value if
 * decoding fails (malformed target).
 */
export function decodeWikiTarget(encoded: string): string {
	try {
		return decodeURIComponent(encoded);
	} catch {
		return encoded;
	}
}

/**
 * Lists the wiki-link targets referenced in a markdown document. Used to
 * compute backlinks (filesStore.backlinks).
 *
 * Returns each target ONLY ONCE (deduplication via Set), trimmed, case
 * preserved. The caller then compares by name/id.
 */
export function extractWikiLinkTargets(md: string): string[] {
	// Same alternating scanner as preprocessWikiLinks: skip fenced/inline code so
	// examples in ``` blocks do not become false backlinks / graph edges.
	// Classes excluding `[` on the wiki arm - cf. preprocessWikiLinks (anti-ReDoS).
	const pattern =
		/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)|\[\[([^[\]|\n]+?)(?:\|[^[\]\n]+?)?\]\]/g;
	const seen = new Set<string>();
	let m: RegExpExecArray | null;
	while ((m = pattern.exec(md)) !== null) {
		if (m[1] !== undefined) continue; // code region
		// invariant: m[2] is the wiki target capture when the code arm did not match.
		const t = m[2]!.trim();
		if (t) seen.add(t);
	}
	return [...seen];
}
