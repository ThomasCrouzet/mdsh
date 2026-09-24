import { beforeEach, describe, expect, it } from 'vitest';
import { EditorStateCache } from './editor-state';

describe('EditorStateCache', () => {
	beforeEach(() => sessionStorage.clear());

	it('restores positions from sessionStorage without persisting source history', () => {
		const first = new EditorStateCache();
		first.setSourceState(
			'draft-a',
			{ content: 'A', state: { doc: 'A', history: { done: ['large'] } } },
			{ anchor: 1, head: 1, scrollTop: 12 }
		);

		const restored = new EditorStateCache();
		expect(restored.getPosition('draft-a', 'source')?.scrollTop).toBe(12);
		expect(restored.getSourceState('draft-a')).toBeUndefined();
	});

	it('evicts the least recently used draft', () => {
		const cache = new EditorStateCache(2);
		cache.setPosition('draft-a', 'source', { anchor: 0, head: 0, scrollTop: 1 });
		cache.setPosition('draft-b', 'source', { anchor: 0, head: 0, scrollTop: 2 });
		cache.getPosition('draft-a', 'source');
		cache.setPosition('draft-c', 'source', { anchor: 0, head: 0, scrollTop: 3 });

		expect(cache.getPosition('draft-a', 'source')).toBeDefined();
		expect(cache.getPosition('draft-b', 'source')).toBeUndefined();
		expect(cache.getPosition('draft-c', 'source')).toBeDefined();
	});

	it('normalizes positions and returns defensive copies', () => {
		const cache = new EditorStateCache();
		cache.setPosition('draft-a', 'wysiwyg', {
			anchor: -3.7,
			head: Number.NaN,
			scrollTop: Number.POSITIVE_INFINITY
		});

		const position = cache.getPosition('draft-a', 'wysiwyg');
		expect(position).toEqual({ anchor: 0, head: 0, scrollTop: 0 });
		if (position) position.anchor = 12;
		expect(cache.getPosition('draft-a', 'wysiwyg')?.anchor).toBe(0);
	});

	it('ignores malformed persisted entries', () => {
		sessionStorage.setItem('mdsh:editor-view-state', '{bad json');
		expect(new EditorStateCache().size).toBe(0);

		sessionStorage.setItem(
			'mdsh:editor-view-state',
			JSON.stringify([
				null,
				{},
				{ fileId: '', positions: {} },
				{ fileId: 'bad-positions', positions: 'text' },
				{
					fileId: 'mixed',
					positions: {
						source: { anchor: 4, head: 4, scrollTop: 10 },
						read: { anchor: 'bad', head: 0, scrollTop: 20 }
					}
				}
			])
		);
		const cache = new EditorStateCache();
		expect(cache.size).toBe(1);
		expect(cache.getPosition('mixed', 'source')).toEqual({
			anchor: 4,
			head: 4,
			scrollTop: 10
		});
		expect(cache.getPosition('mixed', 'read')).toBeUndefined();
	});
});
