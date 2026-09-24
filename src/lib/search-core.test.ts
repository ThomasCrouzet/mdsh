import { describe, it, expect } from 'vitest';
import { matchInCorpus, corpusFingerprint } from './search-core';

const corpus = [
	{ id: '1', name: 'a.md', content: 'Hello world\nsecond line' },
	{ id: '2', name: 'b.md', content: 'Hello again\nworld peace' }
];

describe('matchInCorpus', () => {
	it.each(['été', 'élève', 'café', 'cafe\u0301', 'word', '123'])(
		'matches Unicode word boundaries for %s',
		(word) => {
			const result = matchInCorpus(
				[
					{
						id: 'x',
						name: 'x.md',
						content: `${word}\npre${word}post\n${word}x\nx${word}\n'${word}'`
					}
				],
				{ query: word, caseSensitive: false, wholeWord: true, useRegex: false }
			);
			expect(result.hits.map((hit) => hit.line)).toEqual([1, 5]);
		}
	);

	it('respects caseSensitive', () => {
		const { hits } = matchInCorpus(corpus, {
			query: 'hello',
			caseSensitive: true,
			wholeWord: false,
			useRegex: false
		});
		expect(hits).toEqual([]);
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
});
