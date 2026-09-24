import { describe, it, expect } from 'vitest';
import { rangeSelection } from './selection';

describe('rangeSelection', () => {
	const ids = ['a', 'b', 'c', 'd'] as const;

	it('is a no-op copy when an id is unknown', () => {
		const next = rangeSelection(new Set(['a']), ids, 'a', 'missing');
		expect([...next]).toEqual(['a']);
	});
});
