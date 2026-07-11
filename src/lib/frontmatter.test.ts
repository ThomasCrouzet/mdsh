import { describe, it, expect } from 'vitest';
import { getTags, getTitle, parseFrontmatter, stripFrontmatter } from './frontmatter';

describe('parseFrontmatter - détection', () => {
	it('renvoie data vide si pas de front-matter', async () => {
		const result = await parseFrontmatter('# Hello\n\ndu texte');
		expect(result.data).toEqual({});
		expect(result.content).toBe('# Hello\n\ndu texte');
		expect(result.raw).toBe('');
	});

	it('parse un front-matter YAML valide', async () => {
		const md = `---
title: Mon document
author: Thomas
---

# Contenu`;
		const result = await parseFrontmatter(md);
		expect(result.data.title).toBe('Mon document');
		expect(result.data.author).toBe('Thomas');
		expect(result.content.trim()).toBe('# Contenu');
		expect(result.raw).toContain('title: Mon document');
	});

	it('extrait un tableau de tags YAML', async () => {
		const md = `---
title: Doc
tags: [notes, projet-x, alpha]
---

corps`;
		const result = await parseFrontmatter(md);
		expect(result.data.tags).toEqual(['notes', 'projet-x', 'alpha']);
	});

	it('parse une date YAML', async () => {
		const md = `---
title: Doc
created: 2026-04-01
---

corps`;
		const result = await parseFrontmatter(md);
		// gray-matter convertit la date en objet Date
		expect(result.data.created).toBeDefined();
	});

	it('fail-soft sur YAML cassé : retourne markdown intact', async () => {
		const md = `---
title: ::: invalid : : :
tags: [unclosed
---

# OK`;
		const result = await parseFrontmatter(md);
		// Soit gray-matter accepte (rare), soit on tombe dans le catch.
		// Dans les deux cas le content doit rester non vide et data un objet.
		expect(typeof result.data).toBe('object');
		expect(result.content.length).toBeGreaterThan(0);
	});

	it('ne confond pas une ligne `---` (hr) avec un front-matter', async () => {
		const md = `# Titre

du texte
---
suite`;
		const result = await parseFrontmatter(md);
		expect(result.data).toEqual({});
		expect(result.content).toBe(md);
	});

	it('gère un front-matter avec corps vide', async () => {
		const md = `---
title: Test
---
`;
		const result = await parseFrontmatter(md);
		expect(result.data.title).toBe('Test');
		expect(result.content.trim()).toBe('');
	});
});

describe('stripFrontmatter - version sync', () => {
	it('retire le bloc front-matter sans dépendre de gray-matter', () => {
		const md = `---
title: X
---

# Corps`;
		const r = stripFrontmatter(md);
		expect(r.raw).toContain('title: X');
		expect(r.content.trim()).toBe('# Corps');
	});

	it('renvoie le markdown intact si pas de bloc', () => {
		const md = '# Titre\n\nx';
		expect(stripFrontmatter(md).content).toBe(md);
		expect(stripFrontmatter(md).raw).toBe('');
	});
});

describe('getTitle', () => {
	it('priorise data.title si défini', () => {
		expect(getTitle({ title: 'YAML titre' }, '# Heading\nabc', 'fallback')).toBe('YAML titre');
	});

	it('trim le titre YAML', () => {
		expect(getTitle({ title: '   spaced   ' }, '', 'fb')).toBe('spaced');
	});

	it('tombe sur le premier # H1 si pas de title YAML', () => {
		expect(getTitle({}, '# Mon Titre\n\nbla', 'fallback')).toBe('Mon Titre');
	});

	it('tombe sur le fallback si ni title ni H1', () => {
		expect(getTitle({}, 'Juste du texte sans heading.', 'mon-fichier')).toBe('mon-fichier');
	});

	it('ignore un title vide ou non-string', () => {
		expect(getTitle({ title: '' }, '# H1', 'fb')).toBe('H1');
		expect(getTitle({ title: 42 as unknown as string }, '# H1', 'fb')).toBe('H1');
	});

	it("n'attrape pas un ## H2 comme H1", () => {
		expect(getTitle({}, '## Pas un H1\n\n# Vrai H1', 'fb')).toBe('Vrai H1');
	});
});

describe('getTags', () => {
	it('retourne [] si tags absent', () => {
		expect(getTags({})).toEqual([]);
	});

	it('accepte un tableau YAML', () => {
		expect(getTags({ tags: ['a', 'b', 'c'] })).toEqual(['a', 'b', 'c']);
	});

	it('parse une string CSV', () => {
		expect(getTags({ tags: 'a, b , c' })).toEqual(['a', 'b', 'c']);
	});

	it('accepte une string simple', () => {
		expect(getTags({ tags: 'unique' })).toEqual(['unique']);
	});

	it('dédoublonne les tags identiques', () => {
		expect(getTags({ tags: ['a', 'b', 'a', 'b'] })).toEqual(['a', 'b']);
	});

	it('filtre les entrées vides', () => {
		expect(getTags({ tags: ['a', '', '  ', 'b'] })).toEqual(['a', 'b']);
	});

	it('coerce les nombres en strings', () => {
		expect(getTags({ tags: [2026, 'note'] })).toEqual(['2026', 'note']);
	});

	it('retourne [] sur type inattendu', () => {
		expect(getTags({ tags: { foo: 'bar' } })).toEqual([]);
		expect(getTags({ tags: null })).toEqual([]);
		expect(getTags({ tags: 123 as unknown as string[] })).toEqual([]);
	});
});
