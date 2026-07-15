import { describe, it, expect } from 'vitest';
import { toggleSelection, rangeSelection, clearSelection } from './selection';

describe('toggleSelection', () => {
	it('adds an id that was not selected', () => {
		const next = toggleSelection(new Set(['a']), 'b');
		expect([...next].sort()).toEqual(['a', 'b']);
	});

	it('removes an id that was selected', () => {
		const next = toggleSelection(new Set(['a', 'b']), 'a');
		expect([...next]).toEqual(['b']);
	});

	it('does not mutate the input set', () => {
		const input = new Set(['a']);
		toggleSelection(input, 'b');
		expect([...input]).toEqual(['a']);
	});
});

describe('rangeSelection', () => {
	const ids = ['a', 'b', 'c', 'd'] as const;

	it('selects an inclusive forward range', () => {
		const next = rangeSelection(new Set(), ids, 'b', 'd');
		expect([...next].sort()).toEqual(['b', 'c', 'd']);
	});

	it('selects an inclusive reverse range', () => {
		const next = rangeSelection(new Set(), ids, 'd', 'b');
		expect([...next].sort()).toEqual(['b', 'c', 'd']);
	});

	it('unions with the existing selection', () => {
		const next = rangeSelection(new Set(['a']), ids, 'c', 'd');
		expect([...next].sort()).toEqual(['a', 'c', 'd']);
	});

	it('is a no-op copy when an id is unknown', () => {
		const next = rangeSelection(new Set(['a']), ids, 'a', 'missing');
		expect([...next]).toEqual(['a']);
	});
});

describe('clearSelection', () => {
	it('returns an empty set', () => {
		expect(clearSelection().size).toBe(0);
	});
});
