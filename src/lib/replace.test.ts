import { describe, it, expect } from 'vitest';
import { buildReplaceRegex, replaceInFiles, type FileSlice } from './replace';

const OPTS = { caseSensitive: false, wholeWord: false, useRegex: false };

function files(...pairs: Array<[string, string]>): FileSlice[] {
	return pairs.map(([id, content]) => ({ id, name: `${id}.md`, content }));
}

describe('buildReplaceRegex', () => {
	it('littéral : échappe les métacaractères', () => {
		const { re } = buildReplaceRegex('a.b', OPTS);
		expect(re?.test('a.b')).toBe(true);
		expect(re?.test('aXb')).toBe(false); // le point est littéral
	});
	it('mot entier : ajoute les bornes \\b', () => {
		const { re } = buildReplaceRegex('cat', { ...OPTS, wholeWord: true });
		expect(re?.test('a cat sat')).toBe(true);
		expect(re?.test('category')).toBe(false);
	});
	it('regex : compile le motif tel quel', () => {
		const { re } = buildReplaceRegex('a\\d+', { ...OPTS, useRegex: true });
		expect(re?.test('a123')).toBe(true);
	});
	it('regex invalide : renvoie une erreur', () => {
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
	it('casse : insensible par défaut, sensible si demandé', () => {
		expect(buildReplaceRegex('foo', OPTS).re?.test('FOO')).toBe(true);
		expect(buildReplaceRegex('foo', { ...OPTS, caseSensitive: true }).re?.test('FOO')).toBe(false);
	});
});

describe('replaceInFiles', () => {
	it('remplace dans plusieurs fichiers et compte les occurrences', () => {
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

	it('garde-fou : ignore les requêtes < 2 caractères', () => {
		const out = replaceInFiles(files(['a', 'aaa']), 'a', 'X', OPTS);
		expect(out.total).toBe(0);
		expect(out.results).toEqual([]);
	});

	it('mode littéral : un $ dans le remplacement reste littéral', () => {
		const out = replaceInFiles(files(['a', 'prix: NN']), 'NN', '$5', OPTS);
		expect(out.results[0]?.content).toBe('prix: $5');
	});

	it('mode regex : les backrefs sont expansés', () => {
		const out = replaceInFiles(files(['a', 'John Smith']), '(\\w+) (\\w+)', '$2 $1', {
			caseSensitive: false,
			wholeWord: false,
			useRegex: true
		});
		expect(out.results[0]?.content).toBe('Smith John');
	});

	it('propage l’erreur regex sans rien modifier', () => {
		const out = replaceInFiles(files(['a', 'x']), 'a(', 'y', {
			caseSensitive: false,
			wholeWord: false,
			useRegex: true
		});
		expect(out.regexError).toBeTruthy();
		expect(out.results).toEqual([]);
	});

	it('ignore un remplacement qui ne change rien (a→a)', () => {
		const out = replaceInFiles(files(['a', 'aa bb']), 'aa', 'aa', OPTS);
		expect(out.results).toEqual([]);
		expect(out.total).toBe(0);
	});

	it('respecte le mot entier', () => {
		const out = replaceInFiles(files(['a', 'cat category']), 'cat', 'dog', {
			...OPTS,
			wholeWord: true
		});
		expect(out.results[0]?.content).toBe('dog category');
		expect(out.total).toBe(1);
	});
});
