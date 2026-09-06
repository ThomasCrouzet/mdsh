// Obsidian and Logseq style wiki links: `[[File name]]`, `[[id-uuid]]`, and
// `[[Name|displayed alias]]`. ReadView handles navigation without adding a store
// dependency to the renderer. It calls `filesStore.setActive` or creates the missing file.
//
// The module stays pure (zero store dependency, zero DOM) to remain lazy-load
// friendly and easily testable.

import { escapeHTML } from './file-utils';

/**
 * Creates an ASCII slug: lowercases text, removes diacritics, and replaces
 * nonalphanumeric characters with `-`. The slug identifies `<a>` anchors as `#mdsh-wiki-{slug}`.
 * The slug need not be reversible. `data-mdsh-wiki` keeps the raw name for resolution.
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
 * Converts `[[Target]]` and `[[Target|alias]]` to an HTML link before marked
 * parses the text. This avoids conflicts between extensions and GFM tokens.
 *
 * The produced HTML:
 *   <a href="#mdsh-wiki-{slug}" data-mdsh-wiki="{encoded-target}" class="wiki-link">{label}</a>
 *
 * - `href`: internal anchor. The clickable component prevents navigation and
 *   delegates to the store.
 * - `data-mdsh-wiki`: raw name encoded with `encodeURIComponent` for exact
 *   resolution by file name or file ID. Encoding prevents DOMPurify and XSS
 *   filters from removing attributes with HTML-like values, such as `[[<weird>]]`.
 *   ReadView decodes the value with `decodeWikiTarget`.
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
