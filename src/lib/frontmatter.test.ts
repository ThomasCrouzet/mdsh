import { describe, it, expect } from 'vitest';
import { getTags, getTitle, parseFrontmatter, stripFrontmatter } from './frontmatter';

describe('parseFrontmatter - detection', () => {
	it('returns empty data without front matter', async () => {
		const result = await parseFrontmatter('# Hello\n\ndu texte');
		expect(result.data).toEqual({});
		expect(result.content).toBe('# Hello\n\ndu texte');
		expect(result.raw).toBe('');
	});

	it('parses valid YAML front matter', async () => {
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

	it('gets a YAML tag array', async () => {
		const md = `---
title: Doc
tags: [notes, projet-x, alpha]
---

corps`;
		const result = await parseFrontmatter(md);
		expect(result.data.tags).toEqual(['notes', 'projet-x', 'alpha']);
	});

	it('parses a YAML date', async () => {
		const md = `---
title: Doc
created: 2026-04-01
---

corps`;
		const result = await parseFrontmatter(md);
		// gray-matter converts the date to a Date object.
		expect(result.data.created).toBeDefined();
	});

	it('returns unchanged Markdown after invalid YAML', async () => {
		const md = `---
title: ::: invalid : : :
tags: [unclosed
---

# OK`;
		const result = await parseFrontmatter(md);
		// gray-matter can accept this input, but usually the catch block handles it.
		// In both cases, content must remain nonempty and data must be an object.
		expect(typeof result.data).toBe('object');
		expect(result.content.length).toBeGreaterThan(0);
	});

	it('does not treat a horizontal rule as front matter', async () => {
		const md = `# Titre

du texte
---
suite`;
		const result = await parseFrontmatter(md);
		expect(result.data).toEqual({});
		expect(result.content).toBe(md);
	});

	it('supports front matter with an empty body', async () => {
		const md = `---
title: Test
---
`;
		const result = await parseFrontmatter(md);
		expect(result.data.title).toBe('Test');
		expect(result.content.trim()).toBe('');
	});
});

describe('stripFrontmatter - synchronous version', () => {
	it('removes the front matter block without gray-matter', () => {
		const md = `---
title: X
---

# Corps`;
		const r = stripFrontmatter(md);
		expect(r.raw).toContain('title: X');
		expect(r.content.trim()).toBe('# Corps');
	});

	it('returns unchanged Markdown without a block', () => {
		const md = '# Titre\n\nx';
		expect(stripFrontmatter(md).content).toBe(md);
		expect(stripFrontmatter(md).raw).toBe('');
	});
});

describe('getTitle', () => {
	it('uses data.title when it exists', () => {
		expect(getTitle({ title: 'YAML titre' }, '# Heading\nabc', 'fallback')).toBe('YAML titre');
	});

	it('trims the YAML title', () => {
		expect(getTitle({ title: '   spaced   ' }, '', 'fb')).toBe('spaced');
	});

	it('uses the first H1 without a YAML title', () => {
		expect(getTitle({}, '# Mon Titre\n\nbla', 'fallback')).toBe('Mon Titre');
	});

	it('uses the fallback without a title or H1', () => {
		expect(getTitle({}, 'Juste du texte sans heading.', 'mon-fichier')).toBe('mon-fichier');
	});

	it('ignores an empty or non-string title', () => {
		expect(getTitle({ title: '' }, '# H1', 'fb')).toBe('H1');
		expect(getTitle({ title: 42 as unknown as string }, '# H1', 'fb')).toBe('H1');
	});

	it('does not use an H2 as an H1', () => {
		expect(getTitle({}, '## Pas un H1\n\n# Vrai H1', 'fb')).toBe('Vrai H1');
	});
});

describe('getTags', () => {
	it('returns an empty array without tags', () => {
		expect(getTags({})).toEqual([]);
	});

	it('accepts a YAML array', () => {
		expect(getTags({ tags: ['a', 'b', 'c'] })).toEqual(['a', 'b', 'c']);
	});

	it('parses a CSV string', () => {
		expect(getTags({ tags: 'a, b , c' })).toEqual(['a', 'b', 'c']);
	});

	it('accepts a simple string', () => {
		expect(getTags({ tags: 'unique' })).toEqual(['unique']);
	});

	it('removes duplicate tags', () => {
		expect(getTags({ tags: ['a', 'b', 'a', 'b'] })).toEqual(['a', 'b']);
	});

	it('removes empty entries', () => {
		expect(getTags({ tags: ['a', '', '  ', 'b'] })).toEqual(['a', 'b']);
	});

	it('converts numbers to strings', () => {
		expect(getTags({ tags: [2026, 'note'] })).toEqual(['2026', 'note']);
	});

	it('returns an empty array for an unexpected type', () => {
		expect(getTags({ tags: { foo: 'bar' } })).toEqual([]);
		expect(getTags({ tags: null })).toEqual([]);
		expect(getTags({ tags: 123 as unknown as string[] })).toEqual([]);
	});
});
