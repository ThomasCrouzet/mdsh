import { describe, it, expect } from 'vitest';
import { MetaIndex } from './meta-index';
import type { FileItem } from './types';

// Create a minimal FileItem for tests.
function makeFile(partial: Partial<FileItem> & { id: string; name: string }): FileItem {
	return {
		content: '',
		createdAt: 0,
		updatedAt: 0,
		dirty: false,
		...partial
	};
}

// Create a MetaIndex with a mutable file list that behaves like a store.
function makeIndex(initial: FileItem[] = []) {
	const files: FileItem[] = [...initial];
	const index = new MetaIndex(() => files);
	return { index, files };
}

// ───── displayTitle ──────────────────────────────────────────────────────────

describe('MetaIndex - displayTitle', () => {
	it('returns the file name without its extension when there is no front matter or H1', () => {
		const { index, files } = makeIndex();
		const f = makeFile({ id: '1', name: 'mon-doc.md', content: 'paragraphe simple' });
		files.push(f);
		expect(index.displayTitle('1')).toBe('mon-doc');
	});

	it('returns the title from YAML front matter', () => {
		const { index, files } = makeIndex();
		const f = makeFile({
			id: '2',
			name: 'fichier.md',
			content: '---\ntitle: Mon Titre YAML\n---\ncontenu'
		});
		files.push(f);
		expect(index.displayTitle('2')).toBe('Mon Titre YAML');
	});

	it('returns the file name without .md when front matter is absent', () => {
		// The store contract uses the file name when there is no front matter.
		// Use the H1 only when front matter exists without `title:`.
		const { index, files } = makeIndex();
		const f = makeFile({ id: '3', name: 'note.md', content: '# Premier Titre\n\nbody' });
		files.push(f);
		expect(index.displayTitle('3')).toBe('note');
	});

	it('returns the H1 when front matter has no title', () => {
		const { index, files } = makeIndex();
		const f = makeFile({
			id: '3b',
			name: 'note.md',
			content: '---\ntags: [foo]\n---\n# Mon Titre H1\n\nbody'
		});
		files.push(f);
		expect(index.displayTitle('3b')).toBe('Mon Titre H1');
	});

	it('uses YAML title before H1 and file name', () => {
		const { index, files } = makeIndex();
		const f = makeFile({
			id: '4',
			name: 'doc.md',
			content: '---\ntitle: YAML gagne\n---\n# H1 perd\n\nbody'
		});
		files.push(f);
		expect(index.displayTitle('4')).toBe('YAML gagne');
	});

	it('returns an empty string for an unknown ID', () => {
		const { index } = makeIndex();
		expect(index.displayTitle('inexistant')).toBe('');
	});

	it('supports single and double quotes in a YAML title', () => {
		const { index, files } = makeIndex();
		const f = makeFile({ id: '5', name: 'q.md', content: "---\ntitle: 'Mon titre'\n---\n" });
		files.push(f);
		expect(index.displayTitle('5')).toBe('Mon titre');
	});
});

// ───── getTags ───────────────────────────────────────────────────────────────

describe('MetaIndex - getTags', () => {
	it('returns [] for a file without tags', () => {
		const { index, files } = makeIndex();
		files.push(makeFile({ id: 'a', name: 'a.md', content: 'pas de fm' }));
		expect(index.getTags('a')).toEqual([]);
	});

	it('parses tags from a YAML list', () => {
		const { index, files } = makeIndex();
		files.push(
			makeFile({ id: 'b', name: 'b.md', content: '---\ntags: [svelte, typescript]\n---\n' })
		);
		expect(index.getTags('b')).toEqual(['svelte', 'typescript']);
	});

	it('parses comma-separated tags', () => {
		const { index, files } = makeIndex();
		files.push(makeFile({ id: 'c', name: 'c.md', content: '---\ntags: foo, bar\n---\n' }));
		expect(index.getTags('c')).toEqual(['foo', 'bar']);
	});

	it('returns [] for an unknown ID', () => {
		const { index } = makeIndex();
		expect(index.getTags('nope')).toEqual([]);
	});
});

// ───── allTags ───────────────────────────────────────────────────────────────

describe('MetaIndex - allTags', () => {
	it('lists all unique tags in alphabetical order', () => {
		const { index, files } = makeIndex();
		files.push(makeFile({ id: 'x', name: 'x.md', content: '---\ntags: [svelte, dev]\n---\n' }));
		files.push(makeFile({ id: 'y', name: 'y.md', content: '---\ntags: [dev, typescript]\n---\n' }));
		expect(index.allTags).toEqual(['dev', 'svelte', 'typescript']);
	});

	it('removes duplicate tags from multiple files', () => {
		const { index, files } = makeIndex();
		files.push(makeFile({ id: 'p', name: 'p.md', content: '---\ntags: [tag-a]\n---\n' }));
		files.push(makeFile({ id: 'q', name: 'q.md', content: '---\ntags: [tag-a, tag-b]\n---\n' }));
		expect(index.allTags).toEqual(['tag-a', 'tag-b']);
	});

	it('returns [] when there are no files', () => {
		const { index } = makeIndex();
		expect(index.allTags).toEqual([]);
	});
});

// ───── wikiLinkTargets ───────────────────────────────────────────────────────

describe('MetaIndex - wikiLinkTargets', () => {
	it('gets unique wiki link targets', () => {
		const { index, files } = makeIndex();
		files.push(
			makeFile({
				id: 'w',
				name: 'w.md',
				content: 'Voir [[Notes]] et [[Idées]] puis encore [[Notes]].'
			})
		);
		const targets = index.wikiLinkTargets('w');
		expect(targets).toContain('Notes');
		expect(targets).toContain('Idées');
		expect(targets).toHaveLength(2);
	});

	it('returns [] when there are no wiki links', () => {
		const { index, files } = makeIndex();
		files.push(makeFile({ id: 'e', name: 'e.md', content: 'rien' }));
		expect(index.wikiLinkTargets('e')).toEqual([]);
	});
});

// ───── backlinks ─────────────────────────────────────────────────────────────

describe('MetaIndex - backlinks', () => {
	it('returns files that point to the named target', () => {
		const { index, files } = makeIndex();
		const target = makeFile({ id: 'tgt', name: 'Cible.md', content: '' });
		const linker = makeFile({ id: 'src', name: 'Source.md', content: 'Voir [[Cible]].' });
		files.push(target, linker);
		const bl = index.backlinks('tgt');
		expect(bl.map((f) => f.id)).toContain('src');
		expect(bl.map((f) => f.id)).not.toContain('tgt');
	});

	it('excludes self-links', () => {
		const { index, files } = makeIndex();
		const self = makeFile({ id: 's', name: 'Self.md', content: '[[Self]]' });
		files.push(self);
		expect(index.backlinks('s')).toEqual([]);
	});

	it('finds names without case sensitivity', () => {
		const { index, files } = makeIndex();
		const target = makeFile({ id: 'ci', name: 'CasseSens.md', content: '' });
		const linker = makeFile({ id: 'li', name: 'Linker.md', content: '[[cassesens]]' });
		files.push(target, linker);
		const bl = index.backlinks('ci');
		expect(bl.map((f) => f.id)).toContain('li');
	});

	it('returns [] when no file points to the target', () => {
		const { index, files } = makeIndex();
		files.push(makeFile({ id: 'lone', name: 'Seul.md', content: 'aucun lien' }));
		expect(index.backlinks('lone')).toEqual([]);
	});

	it('returns [] for an unknown ID', () => {
		const { index } = makeIndex();
		expect(index.backlinks('nope')).toEqual([]);
	});
});

// ───── resolveWikiLink ───────────────────────────────────────────────────────

describe('MetaIndex - resolveWikiLink', () => {
	it('uses an exact ID first', () => {
		const { index, files } = makeIndex();
		files.push(makeFile({ id: 'abc-123', name: 'note.md', content: '' }));
		expect(index.resolveWikiLink('abc-123')).toBe('abc-123');
	});

	it('finds a name without its extension or case sensitivity', () => {
		const { index, files } = makeIndex();
		files.push(makeFile({ id: 'n1', name: 'Mon Document.md', content: '' }));
		expect(index.resolveWikiLink('mon document')).toBe('n1');
	});

	it('returns null when there is no match', () => {
		const { index, files } = makeIndex();
		files.push(makeFile({ id: 'n2', name: 'autre.md', content: '' }));
		expect(index.resolveWikiLink('inexistant')).toBeNull();
	});

	it('returns null for an empty target', () => {
		const { index } = makeIndex();
		expect(index.resolveWikiLink('   ')).toBeNull();
	});
});

// ───── invalidateMeta ────────────────────────────────────────────────────────

describe('MetaIndex - invalidateMeta cache updates', () => {
	it('calculates the title again after invalidation', () => {
		const { index, files } = makeIndex();
		const f = makeFile({ id: 'r', name: 'initial.md', content: '' });
		files.push(f);
		// Warm the cache.
		expect(index.displayTitle('r')).toBe('initial');
		// Simulate a rename and invalidation. The previous push guarantees files[0].
		files[0]!.name = 'renommé.md';
		index.invalidateMeta('r');
		expect(index.displayTitle('r')).toBe('renommé');
	});

	it('invalidates the backlinks index until the next access', () => {
		const { index, files } = makeIndex();
		const target = makeFile({ id: 't', name: 'Target.md', content: '' });
		const src = makeFile({ id: 's', name: 'Src.md', content: '[[Target]]' });
		files.push(target, src);
		// Warm the index.
		expect(index.backlinks('t').map((f) => f.id)).toContain('s');
		// Remove the link and invalidate it. The previous pushes guarantee files[1].
		files[1]!.content = 'plus de lien';
		index.invalidateMeta('s');
		// The rebuilt index must not contain the backlink.
		expect(index.backlinks('t')).toEqual([]);
	});

	it('keeps metaCache when only invalidateBacklinksIndex runs', () => {
		const { index, files } = makeIndex();
		files.push(makeFile({ id: 'x', name: 'x.md', content: '---\ntitle: Fixe\n---\n' }));
		// Warm the metadata cache.
		expect(index.displayTitle('x')).toBe('Fixe');
		// Invalidate only the backlink index. Keep the metadata cache.
		index.invalidateBacklinksIndex();
		// displayTitle must continue to work and remain cached.
		expect(index.displayTitle('x')).toBe('Fixe');
	});
});

// ───── getMeta (cache hit/miss) ───────────────────────────────────────────────

describe('MetaIndex - getMeta (invariants cache)', () => {
	it('reuses the cache when content is unchanged', () => {
		const { index, files } = makeIndex();
		const f = makeFile({ id: 'c1', name: 'doc.md', content: '---\ntitle: Stable\n---\n' });
		files.push(f);
		const first = index.getMeta(f);
		const second = index.getMeta(f);
		// The same object reference must not cause a recalculation.
		expect(first).toBe(second);
	});

	it('recalculates after content changes', () => {
		const { index, files } = makeIndex();
		const f = makeFile({ id: 'c2', name: 'doc.md', content: '---\ntitle: Ancien\n---\n' });
		files.push(f);
		const before = index.getMeta(f);
		// Simulate an edit with updateContent and invalidateMeta in the store.
		f.content = '---\ntitle: Nouveau\n---\n';
		index.invalidateMeta('c2');
		const after = index.getMeta(f);
		expect(after.title).toBe('Nouveau');
		expect(before).not.toBe(after);
	});
});

// ───── Fast-path subset vs js-yaml (documented parity) ────────────────────────

describe('MetaIndex - front-matter fast path (supported subset)', () => {
	it('title quoted and unquoted match', () => {
		const { index, files } = makeIndex();
		files.push(makeFile({ id: 't1', name: 'a.md', content: '---\ntitle: Hello\n---\n# body\n' }));
		files.push(
			makeFile({ id: 't2', name: 'b.md', content: '---\ntitle: "Hello quoted"\n---\n# body\n' })
		);
		expect(index.displayTitle('t1')).toBe('Hello');
		expect(index.displayTitle('t2')).toBe('Hello quoted');
	});

	it('tags flow sequence and CSV single-line', () => {
		const { index, files } = makeIndex();
		files.push(makeFile({ id: 'g1', name: 'g1.md', content: '---\ntags: [alpha, beta]\n---\n' }));
		files.push(makeFile({ id: 'g2', name: 'g2.md', content: '---\ntags: gamma, delta\n---\n' }));
		expect(index.getTags('g1').sort()).toEqual(['alpha', 'beta']);
		expect(index.getTags('g2').sort()).toEqual(['delta', 'gamma']);
	});

	it('multiline tags block is out of fast-path scope (empty tags, no crash)', () => {
		const { index, files } = makeIndex();
		files.push(
			makeFile({
				id: 'ml',
				name: 'ml.md',
				content: '---\ntags:\n  - one\n  - two\ntitle: Multi\n---\n'
			})
		);
		// title still works (single-line); multiline tags list is not supported here
		expect(index.displayTitle('ml')).toBe('Multi');
		expect(index.getTags('ml')).toEqual([]);
	});
});
