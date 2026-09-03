import { describe, expect, it } from 'vitest';
import { prefetchTarget } from './prefetch.svelte';

describe('prefetchTarget', () => {
	it('leaves the empty workspace and unselected modes unevaluated', () => {
		expect(prefetchTarget('read', false)).toBeNull();
		expect(prefetchTarget('wysiwyg', true)).toBeNull();
		expect(prefetchTarget('source', true)).toBe('source');
		expect(prefetchTarget('read', true)).toBe('read');
	});

	it('respects data saving and slow connections for every mode', () => {
		for (const mode of ['source', 'read']) {
			expect(prefetchTarget(mode, true, { saveData: true })).toBeNull();
			expect(prefetchTarget(mode, true, { effectiveType: '2g' })).toBeNull();
			expect(prefetchTarget(mode, true, { effectiveType: 'slow-2g' })).toBeNull();
		}
	});
});
