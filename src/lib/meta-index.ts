// §A2.1 / §A2.2 - Metadata index of the file corpus.
//
// Pure class (no Svelte runes): directly testable in Vitest/jsdom.
// The `FilesStore` store instantiates it, passing an accessor `() => FileItem[]`,
// and delegates all reads (tags / backlinks / displayTitle / etc.).
//
// Pattern: the data source (`getFiles`) is a pointer to the store's Svelte 5
// state; the MetaIndex never stores the files - it only caches the parsing
// results (meta per id + inverted backlinks index).
//
// Front-matter fast path (synchronous, no js-yaml):
//   - `title:` single-line scalar (optional quotes)
//   - `tags:` flow sequence `[a, b]` OR single-line CSV `a, b`
// Multiline YAML, nested maps, and complex tags are intentionally out of
// scope here so the sidebar can stay sync on every keystroke. Full YAML
// for display/export goes through async `parseFrontmatter` in frontmatter.ts.
// Parity for the supported subset is covered in `meta-index.test.ts`.

import type { FileItem } from './types';
import { stripMdExtension } from './file-utils';
import { extractWikiLinkTargets } from './wiki-links';
import { getTags as getFmTags, getTitle as getFmTitle, stripFrontmatter } from './frontmatter';

/** Per-file cache entry. */
interface MetaEntry {
	/** Content fingerprint: we invalidate if `content !== file.content`. */
	content: string;
	title: string;
	tags: string[];
	targets: string[];
}

/** Structure of the inverted backlinks index (lazy rebuild). */
interface BacklinksIndex {
	byNameLower: Map<string, Set<string>>;
	byId: Map<string, Set<string>>;
}

export class MetaIndex {
	private metaCache = new Map<string, MetaEntry>();
	private backlinksIndex: BacklinksIndex | null = null;

	/** Reference to the current files state (injected by the store). */
	private getFiles: () => readonly FileItem[];

	constructor(getFiles: () => readonly FileItem[]) {
		this.getFiles = getFiles;
	}

	// §A2.1 - Reads the cache for `file.id` and revalidates it if `content` changed.
	// All meta reads (title/tags/targets) go through here.
	getMeta(file: FileItem): MetaEntry {
		const cached = this.metaCache.get(file.id);
		if (cached && cached.content === file.content) return cached;

		const fallback = stripMdExtension(file.name);
		const { content, raw } = stripFrontmatter(file.content);

		// Title: YAML > first H1 > filename. We reproduce the logic of the old
		// `displayTitle` but without re-parsing on every call.
		// Horizontal whitespace only after the colon so multiline YAML is ignored
		// (full parse stays on async `parseFrontmatter` / js-yaml).
		let title = fallback;
		if (raw) {
			const m = /^title:[ \t]*(.+)$/m.exec(raw);
			// m[1] is guaranteed if m is non-null (mandatory capture group `.+`),
			// but noUncheckedIndexedAccess requires optional chaining on the slot.
			const yamlTitle = m?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? '';
			title = yamlTitle || getFmTitle({}, content, fallback);
		}

		// YAML tags - accepts same-line `[a, b]` or CSV `a, b` only.
		let tags: string[] = [];
		if (raw) {
			const m = /^tags:[ \t]*(.+)$/m.exec(raw);
			if (m) {
				// invariant: m[1] is guaranteed non-undefined (mandatory capture group `.+`).
				const value = m[1]!.trim();
				if (value.startsWith('[') && value.endsWith(']')) {
					tags = getFmTags({
						tags: value
							.slice(1, -1)
							.split(',')
							.map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
							.filter(Boolean)
					});
				} else {
					tags = getFmTags({ tags: value });
				}
			}
		}

		const targets = extractWikiLinkTargets(file.content);

		const entry: MetaEntry = { content: file.content, title, tags, targets };
		this.metaCache.set(file.id, entry);
		return entry;
	}

	// §A2.1+A2.2 - Invalidation: called on write (updateContent), rename
	// (which can change the fallback title), close, restore. The backlinks index
	// depends on the targets of all files → we repurge it on every change.
	invalidateMeta(id: string): void {
		this.metaCache.delete(id);
		this.backlinksIndex = null;
	}

	/** Invalidates only the backlinks index (e.g. adding/removing a file). */
	invalidateBacklinksIndex(): void {
		this.backlinksIndex = null;
	}

	private buildBacklinksIndex(): void {
		const byNameLower = new Map<string, Set<string>>();
		const byId = new Map<string, Set<string>>();
		for (const file of this.getFiles()) {
			const targets = this.getMeta(file).targets;
			for (const t of targets) {
				const tLower = t.toLowerCase();
				let setName = byNameLower.get(tLower);
				if (!setName) {
					setName = new Set();
					byNameLower.set(tLower, setName);
				}
				setName.add(file.id);
				// A target can also be a direct id ([[<uuid>]]). We index both;
				// the lookup in `backlinks()` queries both maps.
				let setId = byId.get(t);
				if (!setId) {
					setId = new Set();
					byId.set(t, setId);
				}
				setId.add(file.id);
			}
		}
		this.backlinksIndex = { byNameLower, byId };
	}

	/**
	 * Front-matter tags of a file - synchronous parsing via regex.
	 * §A2.1 - O(1) lookup via `metaCache` after the first parse.
	 */
	getTags(id: string): string[] {
		const file = this.getFiles().find((f) => f.id === id);
		if (!file) return [];
		return this.getMeta(file).tags;
	}

	/**
	 * Lists all unique tags present in the corpus, sorted alphabetically.
	 * §A2.1 - `getMeta(file)` caches the parsing per file.
	 */
	get allTags(): string[] {
		const set = new Set<string>();
		for (const file of this.getFiles()) {
			for (const t of this.getMeta(file).tags) set.add(t);
		}
		return [...set].sort((a, b) => a.localeCompare(b));
	}

	/**
	 * Priority title: front-matter `title` > first H1 > filename without extension.
	 * §A2.1 - O(1) lookup via `metaCache`.
	 */
	displayTitle(id: string): string {
		const file = this.getFiles().find((f) => f.id === id);
		if (!file) return '';
		return this.getMeta(file).title;
	}

	/**
	 * Backlinks: lists the files that contain a wiki-link pointing to the targeted
	 * file (by name without extension OR by id).
	 *
	 * §A2.2 - O(1) lookup via the inverted index `byNameLower` + `byId`. The index
	 * is rebuilt lazily after a change.
	 */
	backlinks(targetId: string): FileItem[] {
		const files = this.getFiles();
		const target = files.find((f) => f.id === targetId);
		if (!target) return [];
		if (!this.backlinksIndex) this.buildBacklinksIndex();
		const idx = this.backlinksIndex!;
		const targetNameLower = stripMdExtension(target.name).toLowerCase();
		const ids = new Set<string>();
		const byName = idx.byNameLower.get(targetNameLower);
		if (byName) for (const fid of byName) ids.add(fid);
		const byId = idx.byId.get(targetId);
		if (byId) for (const fid of byId) ids.add(fid);
		ids.delete(targetId); // self-link excluded
		if (ids.size === 0) return [];
		return files.filter((f) => ids.has(f.id));
	}

	/**
	 * Wiki-link resolution: returns the id of the file that matches `target` by
	 * name (without extension) or by exact id. `null` if not found.
	 *
	 * Case-insensitive on the name (consistent with `backlinks()`).
	 */
	resolveWikiLink(target: string): string | null {
		const t = target.trim();
		if (!t) return null;
		const files = this.getFiles();
		// Match by exact id first.
		const byId = files.find((f) => f.id === t);
		if (byId) return byId.id;
		// Otherwise, match by name without extension (case-insensitive).
		const tLower = t.toLowerCase();
		const byName = files.find((f) => stripMdExtension(f.name).toLowerCase() === tLower);
		return byName?.id ?? null;
	}

	/**
	 * @internal - exposed for tests / the outgoing links UI.
	 * §A2.1 - O(1) lookup via `metaCache`.
	 */
	wikiLinkTargets(id: string): string[] {
		const file = this.getFiles().find((f) => f.id === id);
		if (!file) return [];
		return this.getMeta(file).targets;
	}
}
