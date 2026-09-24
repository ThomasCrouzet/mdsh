import { describe, it, expect } from 'vitest';
import { getTags, getTitle, parseFrontmatter } from './frontmatter';

describe('parseFrontmatter - detection', () => {
	it('does not treat a horizontal rule as front matter', async () => {
		const md = `# Titre

du texte
---
suite`;
		const result = await parseFrontmatter(md);
		expect(result.data).toEqual({});
		expect(result.content).toBe(md);
	});
});

describe('getTitle', () => {
	it('ignores an empty or non-string title', () => {
		expect(getTitle({ title: '' }, '# H1', 'fb')).toBe('H1');
		expect(getTitle({ title: 42 as unknown as string }, '# H1', 'fb')).toBe('H1');
	});

	it('does not use an H2 as an H1', () => {
		expect(getTitle({}, '## Pas un H1\n\n# Vrai H1', 'fb')).toBe('Vrai H1');
	});
});

describe('getTags', () => {
	it('parses a CSV string', () => {
		expect(getTags({ tags: 'a, b , c' })).toEqual(['a', 'b', 'c']);
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
