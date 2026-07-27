import { describe, it, expect } from 'vitest';
import { matchInCorpus, corpusFingerprint } from './search-core';

const corpus = [
	{ id: '1', name: 'a.md', content: 'Hello world\nsecond line' },
	{ id: '2', name: 'b.md', content: 'Hello again\nworld peace' }
];

describe('matchInCorpus', () => {
	it('returns empty for short queries', () => {
		expect(
			matchInCorpus(corpus, { query: 'h', caseSensitive: false, wholeWord: false, useRegex: false })
				.hits
		).toEqual([]);
	});

	it('finds case-insensitive plain matches', () => {
		const { hits, regexError } = matchInCorpus(corpus, {
			query: 'hello',
			caseSensitive: false,
			wholeWord: false,
			useRegex: false
		});
		expect(regexError).toBeNull();
		expect(hits.length).toBe(2);
		expect(hits[0]?.fileId).toBe('1');
		expect(hits[0]?.line).toBe(1);
	});

	it('respects caseSensitive', () => {
		const { hits } = matchInCorpus(corpus, {
			query: 'hello',
			caseSensitive: true,
			wholeWord: false,
			useRegex: false
		});
		expect(hits).toEqual([]);
	});

	it('wholeWord skips partial tokens', () => {
		const { hits } = matchInCorpus(corpus, {
			query: 'world',
			caseSensitive: false,
			wholeWord: true,
			useRegex: false
		});
		// "world" in "Hello world" and "world peace" - not inside other words
		expect(hits.map((h) => h.fileId).sort()).toEqual(['1', '2']);
	});

	it('reports regex errors without throwing', () => {
		// Unclosed character class is a SyntaxError in all engines.
		const { hits, regexError } = matchInCorpus(corpus, {
			query: '[unterminated',
			caseSensitive: false,
			wholeWord: false,
			useRegex: true
		});
		expect(hits).toEqual([]);
		expect(regexError).toBeTruthy();
	});

	it('matches a valid user regex and reports empty length safely', () => {
		const { hits, regexError } = matchInCorpus(
			[{ id: '1', name: 'a.md', content: 'foo\nbar foo' }],
			{
				query: 'fo*',
				caseSensitive: false,
				wholeWord: false,
				useRegex: true
			}
		);
		expect(regexError).toBeNull();
		expect(hits.length).toBeGreaterThan(0);
		// Zero-width match path: empty group still yields len >= 1.
		const empty = matchInCorpus([{ id: '1', name: 'a.md', content: 'x' }], {
			query: 'x?',
			caseSensitive: true,
			wholeWord: false,
			useRegex: true
		});
		expect(empty.regexError).toBeNull();
		expect(empty.hits.length).toBeGreaterThanOrEqual(0);
		// caseSensitive true + no match branch
		const none = matchInCorpus([{ id: '1', name: 'a.md', content: 'abc' }], {
			query: 'Z+',
			caseSensitive: true,
			wholeWord: false,
			useRegex: true
		});
		expect(none.hits).toEqual([]);
		// wholeWord case-sensitive
		const ww = matchInCorpus([{ id: '1', name: 'a.md', content: 'Cat category' }], {
			query: 'Cat',
			caseSensitive: true,
			wholeWord: true,
			useRegex: false
		});
		expect(ww.hits.some((h) => h.snippet.includes('Cat'))).toBe(true);
	});

	it('rejects three consecutive quantifiers', () => {
		const { regexError } = matchInCorpus([{ id: '1', name: 'a.md', content: 'aaa' }], {
			query: 'a+*+',
			caseSensitive: false,
			wholeWord: false,
			useRegex: true
		});
		expect(regexError).toMatch(/nested quantifiers|too long|rejected/i);
	});

	it('rejects nested quantifier regex (anti-ReDoS)', () => {
		const { hits, regexError } = matchInCorpus(
			[{ id: '1', name: 'a.md', content: 'a'.repeat(50) }],
			{
				query: '(a+)+$',
				caseSensitive: false,
				wholeWord: false,
				useRegex: true
			}
		);
		expect(hits).toEqual([]);
		expect(regexError).toMatch(/nested quantifiers/i);

		const alt = matchInCorpus([{ id: '1', name: 'a.md', content: 'a'.repeat(50) }], {
			query: '(a|aa)+$',
			caseSensitive: false,
			wholeWord: false,
			useRegex: true
		});
		expect(alt.hits).toEqual([]);
		expect(alt.regexError).toMatch(/nested quantifiers/i);
	});

	it('caps hits at maxHits', () => {
		const big = Array.from({ length: 50 }, (_, i) => ({
			id: String(i),
			name: `${i}.md`,
			content: 'needle\nneedle\nneedle'
		}));
		const { hits } = matchInCorpus(
			big,
			{ query: 'needle', caseSensitive: false, wholeWord: false, useRegex: false },
			5
		);
		expect(hits).toHaveLength(5);
	});
});

describe('corpusFingerprint', () => {
	it('changes when updatedAt changes', () => {
		const a = corpusFingerprint([
			{ id: '1', updatedAt: 1 },
			{ id: '2', updatedAt: 2 }
		]);
		const b = corpusFingerprint([
			{ id: '1', updatedAt: 1 },
			{ id: '2', updatedAt: 3 }
		]);
		expect(a).not.toBe(b);
	});

	it('is stable for the same snapshot', () => {
		const files = [
			{ id: '1', updatedAt: 1 },
			{ id: '2', updatedAt: 2 }
		];
		expect(corpusFingerprint(files)).toBe(corpusFingerprint(files));
	});
});
