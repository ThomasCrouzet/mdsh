import { describe, it, expect } from 'vitest';
import { MetaIndex } from './meta-index';
import type { FileItem } from './types';

// Fabrique minimale d'un FileItem pour les tests.
function makeFile(partial: Partial<FileItem> & { id: string; name: string }): FileItem {
	return {
		content: '',
		createdAt: 0,
		updatedAt: 0,
		dirty: false,
		...partial
	};
}

// Fabrique un MetaIndex avec une liste de fichiers mutable (pattern store-like).
function makeIndex(initial: FileItem[] = []) {
	const files: FileItem[] = [...initial];
	const index = new MetaIndex(() => files);
	return { index, files };
}

// ───── displayTitle ──────────────────────────────────────────────────────────

describe('MetaIndex - displayTitle', () => {
	it('retourne le nom sans extension quand pas de front-matter ni H1', () => {
		const { index, files } = makeIndex();
		const f = makeFile({ id: '1', name: 'mon-doc.md', content: 'paragraphe simple' });
		files.push(f);
		expect(index.displayTitle('1')).toBe('mon-doc');
	});

	it('retourne le title du front-matter (YAML)', () => {
		const { index, files } = makeIndex();
		const f = makeFile({
			id: '2',
			name: 'fichier.md',
			content: '---\ntitle: Mon Titre YAML\n---\ncontenu'
		});
		files.push(f);
		expect(index.displayTitle('2')).toBe('Mon Titre YAML');
	});

	it('retourne le filename (sans .md) si pas de front-matter, même avec un H1', () => {
		// Contrat du store : sans front-matter, le fallback est le filename.
		// Le H1 n'est utilisé que quand un front-matter est présent sans `title:`.
		const { index, files } = makeIndex();
		const f = makeFile({ id: '3', name: 'note.md', content: '# Premier Titre\n\nbody' });
		files.push(f);
		expect(index.displayTitle('3')).toBe('note');
	});

	it('retourne le H1 quand front-matter présent sans title:', () => {
		const { index, files } = makeIndex();
		const f = makeFile({
			id: '3b',
			name: 'note.md',
			content: '---\ntags: [foo]\n---\n# Mon Titre H1\n\nbody'
		});
		files.push(f);
		expect(index.displayTitle('3b')).toBe('Mon Titre H1');
	});

	it('priorité : YAML title > H1 > filename', () => {
		const { index, files } = makeIndex();
		const f = makeFile({
			id: '4',
			name: 'doc.md',
			content: '---\ntitle: YAML gagne\n---\n# H1 perd\n\nbody'
		});
		files.push(f);
		expect(index.displayTitle('4')).toBe('YAML gagne');
	});

	it('retourne chaîne vide pour un id inconnu', () => {
		const { index } = makeIndex();
		expect(index.displayTitle('inexistant')).toBe('');
	});

	it('gère les guillemets simples/doubles dans le title YAML', () => {
		const { index, files } = makeIndex();
		const f = makeFile({ id: '5', name: 'q.md', content: "---\ntitle: 'Mon titre'\n---\n" });
		files.push(f);
		expect(index.displayTitle('5')).toBe('Mon titre');
	});
});

// ───── getTags ───────────────────────────────────────────────────────────────

describe('MetaIndex - getTags', () => {
	it('retourne [] pour un fichier sans tags', () => {
		const { index, files } = makeIndex();
		files.push(makeFile({ id: 'a', name: 'a.md', content: 'pas de fm' }));
		expect(index.getTags('a')).toEqual([]);
	});

	it('parse les tags en liste YAML [a, b]', () => {
		const { index, files } = makeIndex();
		files.push(
			makeFile({ id: 'b', name: 'b.md', content: '---\ntags: [svelte, typescript]\n---\n' })
		);
		expect(index.getTags('b')).toEqual(['svelte', 'typescript']);
	});

	it('parse les tags en CSV a, b', () => {
		const { index, files } = makeIndex();
		files.push(makeFile({ id: 'c', name: 'c.md', content: '---\ntags: foo, bar\n---\n' }));
		expect(index.getTags('c')).toEqual(['foo', 'bar']);
	});

	it('retourne [] pour id inconnu', () => {
		const { index } = makeIndex();
		expect(index.getTags('nope')).toEqual([]);
	});
});

// ───── allTags ───────────────────────────────────────────────────────────────

describe('MetaIndex - allTags', () => {
	it('liste tous les tags uniques, triés alpha', () => {
		const { index, files } = makeIndex();
		files.push(makeFile({ id: 'x', name: 'x.md', content: '---\ntags: [svelte, dev]\n---\n' }));
		files.push(makeFile({ id: 'y', name: 'y.md', content: '---\ntags: [dev, typescript]\n---\n' }));
		expect(index.allTags).toEqual(['dev', 'svelte', 'typescript']);
	});

	it('dédoublonne les tags présents dans plusieurs fichiers', () => {
		const { index, files } = makeIndex();
		files.push(makeFile({ id: 'p', name: 'p.md', content: '---\ntags: [tag-a]\n---\n' }));
		files.push(makeFile({ id: 'q', name: 'q.md', content: '---\ntags: [tag-a, tag-b]\n---\n' }));
		expect(index.allTags).toEqual(['tag-a', 'tag-b']);
	});

	it('retourne [] si aucun fichier', () => {
		const { index } = makeIndex();
		expect(index.allTags).toEqual([]);
	});
});

// ───── wikiLinkTargets ───────────────────────────────────────────────────────

describe('MetaIndex - wikiLinkTargets', () => {
	it('extrait les cibles [[...]] de façon dédoublonnée', () => {
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

	it('retourne [] si pas de wiki-links', () => {
		const { index, files } = makeIndex();
		files.push(makeFile({ id: 'e', name: 'e.md', content: 'rien' }));
		expect(index.wikiLinkTargets('e')).toEqual([]);
	});
});

// ───── backlinks ─────────────────────────────────────────────────────────────

describe('MetaIndex - backlinks', () => {
	it('retourne les fichiers qui pointent vers la cible (par nom)', () => {
		const { index, files } = makeIndex();
		const target = makeFile({ id: 'tgt', name: 'Cible.md', content: '' });
		const linker = makeFile({ id: 'src', name: 'Source.md', content: 'Voir [[Cible]].' });
		files.push(target, linker);
		const bl = index.backlinks('tgt');
		expect(bl.map((f) => f.id)).toContain('src');
		expect(bl.map((f) => f.id)).not.toContain('tgt');
	});

	it('exclut les self-links', () => {
		const { index, files } = makeIndex();
		const self = makeFile({ id: 's', name: 'Self.md', content: '[[Self]]' });
		files.push(self);
		expect(index.backlinks('s')).toEqual([]);
	});

	it('lookup insensible à la casse du nom', () => {
		const { index, files } = makeIndex();
		const target = makeFile({ id: 'ci', name: 'CasseSens.md', content: '' });
		const linker = makeFile({ id: 'li', name: 'Linker.md', content: '[[cassesens]]' });
		files.push(target, linker);
		const bl = index.backlinks('ci');
		expect(bl.map((f) => f.id)).toContain('li');
	});

	it('retourne [] si personne ne pointe vers la cible', () => {
		const { index, files } = makeIndex();
		files.push(makeFile({ id: 'lone', name: 'Seul.md', content: 'aucun lien' }));
		expect(index.backlinks('lone')).toEqual([]);
	});

	it('retourne [] pour id inconnu', () => {
		const { index } = makeIndex();
		expect(index.backlinks('nope')).toEqual([]);
	});
});

// ───── resolveWikiLink ───────────────────────────────────────────────────────

describe('MetaIndex - resolveWikiLink', () => {
	it('résout par id exact (priorité)', () => {
		const { index, files } = makeIndex();
		files.push(makeFile({ id: 'abc-123', name: 'note.md', content: '' }));
		expect(index.resolveWikiLink('abc-123')).toBe('abc-123');
	});

	it('résout par nom (sans extension, case-insensitive)', () => {
		const { index, files } = makeIndex();
		files.push(makeFile({ id: 'n1', name: 'Mon Document.md', content: '' }));
		expect(index.resolveWikiLink('mon document')).toBe('n1');
	});

	it('retourne null si aucune correspondance', () => {
		const { index, files } = makeIndex();
		files.push(makeFile({ id: 'n2', name: 'autre.md', content: '' }));
		expect(index.resolveWikiLink('inexistant')).toBeNull();
	});

	it('retourne null pour cible vide', () => {
		const { index } = makeIndex();
		expect(index.resolveWikiLink('   ')).toBeNull();
	});
});

// ───── invalidateMeta ────────────────────────────────────────────────────────

describe('MetaIndex - invalidateMeta (réactivité du cache)', () => {
	it('recalcule le titre après invalidation (ex: rename)', () => {
		const { index, files } = makeIndex();
		const f = makeFile({ id: 'r', name: 'initial.md', content: '' });
		files.push(f);
		// Warm-up du cache
		expect(index.displayTitle('r')).toBe('initial');
		// Simule un rename + invalidation - files[0]! : le push précédent garantit l'index 0.
		files[0]!.name = 'renommé.md';
		index.invalidateMeta('r');
		expect(index.displayTitle('r')).toBe('renommé');
	});

	it("invalide l'index backlinks (rebuild au prochain accès)", () => {
		const { index, files } = makeIndex();
		const target = makeFile({ id: 't', name: 'Target.md', content: '' });
		const src = makeFile({ id: 's', name: 'Src.md', content: '[[Target]]' });
		files.push(target, src);
		// Warm-up de l'index
		expect(index.backlinks('t').map((f) => f.id)).toContain('s');
		// Supprime le lien + invalidation - files[1]! : les deux push précédents garantissent l'index 1.
		files[1]!.content = 'plus de lien';
		index.invalidateMeta('s');
		// L'index doit être rebuild : le backlink doit avoir disparu
		expect(index.backlinks('t')).toEqual([]);
	});

	it('invalidateBacklinksIndex seul ne touche pas le metaCache', () => {
		const { index, files } = makeIndex();
		files.push(makeFile({ id: 'x', name: 'x.md', content: '---\ntitle: Fixe\n---\n' }));
		// Warm le cache méta
		expect(index.displayTitle('x')).toBe('Fixe');
		// Invalide seulement l'index backlinks → le cache méta reste intact
		index.invalidateBacklinksIndex();
		// displayTitle doit toujours fonctionner (et rester en cache)
		expect(index.displayTitle('x')).toBe('Fixe');
	});
});

// ───── getMeta (cache hit/miss) ───────────────────────────────────────────────

describe('MetaIndex - getMeta (invariants cache)', () => {
	it("réutilise le cache si content n'a pas changé", () => {
		const { index, files } = makeIndex();
		const f = makeFile({ id: 'c1', name: 'doc.md', content: '---\ntitle: Stable\n---\n' });
		files.push(f);
		const first = index.getMeta(f);
		const second = index.getMeta(f);
		// Même référence d'objet - pas de recalcul
		expect(first).toBe(second);
	});

	it('recalcule si content change (invalidation implicite par content)', () => {
		const { index, files } = makeIndex();
		const f = makeFile({ id: 'c2', name: 'doc.md', content: '---\ntitle: Ancien\n---\n' });
		files.push(f);
		const before = index.getMeta(f);
		// Simule une édition (updateContent + invalidateMeta dans le store)
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
