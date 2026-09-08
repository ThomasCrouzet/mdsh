import { describe, it, expect } from 'vitest';
import { buildReplaceRegex, replaceInFiles, type FileSlice } from './replace';

const OPTS = { caseSensitive: false, wholeWord: false, useRegex: false };

function files(...pairs: Array<[string, string]>): FileSlice[] {
	return pairs.map(([id, content]) => ({ id, name: `${id}.md`, content }));
}

describe('buildReplaceRegex', () => {
	it('escapes metacharacters in literal mode', () => {
		const { re } = buildReplaceRegex('a.b', OPTS);
		expect(re?.test('a.b')).toBe(true);
		expect(re?.test('aXb')).toBe(false); // The period is literal.
	});
	it('adds word boundaries in whole-word mode', () => {
		const { re } = buildReplaceRegex('cat', { ...OPTS, wholeWord: true });
		expect(re?.test('a cat sat')).toBe(true);
		expect(re?.test('category')).toBe(false);
	});
	it('compiles the unchanged pattern in regular expression mode', () => {
		const { re } = buildReplaceRegex('a\\d+', { ...OPTS, useRegex: true });
		expect(re?.test('a123')).toBe(true);
	});
	it('returns an error for an invalid regular expression', () => {
		const nested = buildReplaceRegex('(a+)+$', { ...OPTS, useRegex: true });
		expect(nested.re).toBeNull();
		expect(nested.error).toMatch(/nested quantifiers/i);

		const tooLong = buildReplaceRegex('a'.repeat(201), { ...OPTS, useRegex: true });
		expect(tooLong.re).toBeNull();
		expect(tooLong.error).toMatch(/too long/i);

		const { re, error } = buildReplaceRegex('a(', { ...OPTS, useRegex: true });
		expect(re).toBeNull();
		expect(error).toBeTruthy();
	});
	it('ignores case by default and matches case on request', () => {
		expect(buildReplaceRegex('foo', OPTS).re?.test('FOO')).toBe(true);
		expect(buildReplaceRegex('foo', { ...OPTS, caseSensitive: true }).re?.test('FOO')).toBe(false);
	});
});

describe('replaceInFiles', () => {
	it('replaces text in multiple files and counts occurrences', () => {
		const out = replaceInFiles(
			files(['a', 'foo foo'], ['b', 'foo'], ['c', 'bar']),
			'foo',
			'X',
			OPTS
		);
		expect(out.total).toBe(3);
		expect(out.results).toHaveLength(2); // 'c' inchangé non listé
		expect(out.results.find((r) => r.id === 'a')?.content).toBe('X X');
		expect(out.results.find((r) => r.id === 'b')?.content).toBe('X');
	});

	it('ignores queries shorter than two characters', () => {
		const out = replaceInFiles(files(['a', 'aaa']), 'a', 'X', OPTS);
		expect(out.total).toBe(0);
		expect(out.results).toEqual([]);
	});

	it('keeps a replacement dollar sign literal in literal mode', () => {
		const out = replaceInFiles(files(['a', 'prix: NN']), 'NN', '$5', OPTS);
		expect(out.results[0]?.content).toBe('prix: $5');
	});

	it('expands backreferences in regular expression mode', () => {
		const out = replaceInFiles(files(['a', 'John Smith']), '(\\w+) (\\w+)', '$2 $1', {
			caseSensitive: false,
			wholeWord: false,
			useRegex: true
		});
		expect(out.results[0]?.content).toBe('Smith John');
	});

	it('returns a regular expression error without changes', () => {
		const out = replaceInFiles(files(['a', 'x']), 'a(', 'y', {
			caseSensitive: false,
			wholeWord: false,
			useRegex: true
		});
		expect(out.regexError).toBeTruthy();
		expect(out.results).toEqual([]);
	});

	it('ignores a replacement that makes no change', () => {
		const out = replaceInFiles(files(['a', 'aa bb']), 'aa', 'aa', OPTS);
		expect(out.results).toEqual([]);
		expect(out.total).toBe(0);
	});

	it('matches whole words', () => {
		const out = replaceInFiles(files(['a', 'cat category']), 'cat', 'dog', {
			...OPTS,
			wholeWord: true
		});
		expect(out.results[0]?.content).toBe('dog category');
		expect(out.total).toBe(1);
	});
});

describe('Unicode whole-word replacement', () => {
	it('keeps partial words and replaces accented words at punctuation boundaries', () => {
		const result = replaceInFiles(
			[{ id: 'x', name: 'x.md', content: "été étéx xété l'été été-été" }],
			'été',
			'hiver',
			{ caseSensitive: false, wholeWord: true, useRegex: false }
		);
		expect(result.total).toBe(4);
		expect(result.results[0]?.content).toBe("hiver étéx xété l'hiver hiver-hiver");
	});
});
