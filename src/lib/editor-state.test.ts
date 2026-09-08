import { beforeEach, describe, expect, it } from 'vitest';
import { EDITOR_STATE_CACHE_LIMIT, EditorStateCache } from './editor-state';

describe('EditorStateCache', () => {
	beforeEach(() => sessionStorage.clear());

	it('keeps independent positions for each mode', () => {
		const cache = new EditorStateCache();
		cache.setPosition('draft-a', 'source', { anchor: 3, head: 5, scrollTop: 90 });
		cache.setPosition('draft-a', 'read', { anchor: 0, head: 0, scrollTop: 240 });

		expect(cache.getPosition('draft-a', 'source')).toEqual({
			anchor: 3,
			head: 5,
			scrollTop: 90
		});
		expect(cache.getPosition('draft-a', 'read')?.scrollTop).toBe(240);
	});

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

	it('keeps a finite positive cache limit', () => {
		expect(new EditorStateCache(Number.NaN).limit).toBe(EDITOR_STATE_CACHE_LIMIT);
		expect(new EditorStateCache(Number.POSITIVE_INFINITY).limit).toBe(EDITOR_STATE_CACHE_LIMIT);
		expect(new EditorStateCache(0).limit).toBe(1);
		expect(new EditorStateCache(2.9).limit).toBe(2);
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

	it('deletes one draft or clears all drafts', () => {
		const cache = new EditorStateCache();
		cache.setPosition('draft-a', 'source', { anchor: 0, head: 0, scrollTop: 1 });
		cache.setPosition('draft-b', 'read', { anchor: 0, head: 0, scrollTop: 2 });

		cache.delete('missing');
		cache.delete('draft-a');
		expect(cache.getPosition('draft-a', 'source')).toBeUndefined();
		expect(cache.size).toBe(1);
		cache.clear();
		expect(cache.size).toBe(0);
		expect(sessionStorage.getItem('mdsh:editor-view-state')).toBe('[]');
	});
});
