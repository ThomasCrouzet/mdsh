import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CrossTabMessage } from './cross-tab';
import {
	applyCrossTabDecision,
	decideCrossTab,
	handleCrossTabPolicy,
	type CrossTabPolicyHost
} from './cross-tab-policy';
import { t } from '$lib/i18n';

function ctx(opts: { loaded?: string[]; pending?: string[]; anyPending?: boolean }) {
	const loaded = new Set(opts.loaded ?? []);
	const pending = new Set(opts.pending ?? []);
	return {
		isLoaded: (id: string) => loaded.has(id),
		isPending: (id: string) => pending.has(id),
		hasAnyPending: () => opts.anyPending ?? pending.size > 0
	};
}

function mockHost(
	partial: Partial<CrossTabPolicyHost> & {
		loaded?: string[];
		pending?: string[];
		names?: Record<string, string>;
	} = {}
): CrossTabPolicyHost {
	const loaded = new Set(partial.loaded ?? []);
	const pending = new Set(partial.pending ?? []);
	const names = partial.names ?? {};
	return {
		isLoaded: (id) => loaded.has(id),
		isPending: (id) => pending.has(id),
		hasAnyPending: () => pending.size > 0,
		fileName: (id) => names[id] ?? id,
		syncDraft: vi.fn(async (_id: string) => {}),
		closeRemoved: vi.fn((_id: string) => {}),
		reloadQuiet: vi.fn(() => {}),
		reloadSiblings: vi.fn(() => {}),
		invalidateAll: vi.fn(() => {}),
		notifyConflict: vi.fn((_message: string) => {}),
		t,
		...partial
	};
}

describe('decideCrossTab', () => {
	it('syncs a loaded clean draft-written', () => {
		expect(
			decideCrossTab({ type: 'draft-written', id: 'a', updatedAt: 1 }, ctx({ loaded: ['a'] }))
		).toEqual({ kind: 'sync-draft', id: 'a' });
	});

	it('ignores a draft-written that is not open here', () => {
		expect(
			decideCrossTab({ type: 'draft-written', id: 'ghost', updatedAt: 1 }, ctx({ loaded: [] }))
		).toEqual({ kind: 'ignore' });
	});

	it('conflicts when the written draft is locally pending', () => {
		expect(
			decideCrossTab(
				{ type: 'draft-written', id: 'a', updatedAt: 1 },
				ctx({ loaded: ['a'], pending: ['a'] })
			)
		).toEqual({ kind: 'conflict-draft', id: 'a' });
	});

	it('closes a remotely removed clean tab', () => {
		expect(decideCrossTab({ type: 'removed', id: 'a' }, ctx({ loaded: ['a'] }))).toEqual({
			kind: 'close-removed',
			id: 'a'
		});
	});

	it('conflicts when the removed draft is locally pending', () => {
		expect(
			decideCrossTab({ type: 'removed', id: 'a' }, ctx({ loaded: ['a'], pending: ['a'] }))
		).toEqual({ kind: 'conflict-removed', id: 'a' });
	});

	it('ignores removal of a tab that is not open', () => {
		expect(decideCrossTab({ type: 'removed', id: 'ghost' }, ctx({ loaded: [] }))).toEqual({
			kind: 'ignore'
		});
	});

	it('reloads on reorder when idle', () => {
		expect(decideCrossTab({ type: 'reorder' }, ctx({}))).toEqual({ kind: 'reload' });
	});

	it('conflicts on reorder when any edit is pending (no invalidate)', () => {
		expect(decideCrossTab({ type: 'reorder' }, ctx({ pending: ['a'] }))).toEqual({
			kind: 'conflict-global',
			invalidateAll: false
		});
	});

	it('reloads siblings on backup-applied when idle', () => {
		expect(decideCrossTab({ type: 'backup-applied' }, ctx({}))).toEqual({
			kind: 'reload-and-siblings'
		});
	});

	it('preserves writers on backup-applied while dirty', () => {
		expect(decideCrossTab({ type: 'backup-applied' }, ctx({ pending: ['a'] }))).toEqual({
			kind: 'conflict-global',
			invalidateAll: false
		});
	});
});

describe('applyCrossTabDecision / handleCrossTabPolicy', () => {
	let host: ReturnType<typeof mockHost>;

	beforeEach(() => {
		host = mockHost({ loaded: ['a'], names: { a: 'note.md' } });
	});

	it('dispatches sync-draft to the host', () => {
		applyCrossTabDecision({ kind: 'sync-draft', id: 'a' }, host);
		expect(vi.mocked(host.syncDraft)).toHaveBeenCalledWith('a');
	});

	it('notifies a named draft conflict via t()', () => {
		applyCrossTabDecision({ kind: 'conflict-draft', id: 'a' }, host);
		expect(vi.mocked(host.notifyConflict)).toHaveBeenCalledOnce();
		expect(vi.mocked(host.notifyConflict).mock.calls[0]![0]).toContain('note.md');
	});

	it('notifies without discarding dirty writers on backup-applied', () => {
		const dirty = mockHost({ loaded: ['a'], pending: ['a'], names: { a: 'note.md' } });
		handleCrossTabPolicy({ type: 'backup-applied' }, dirty);
		expect(vi.mocked(dirty.invalidateAll)).not.toHaveBeenCalled();
		expect(vi.mocked(dirty.notifyConflict)).toHaveBeenCalledOnce();
		expect(vi.mocked(dirty.reloadQuiet)).not.toHaveBeenCalled();
	});

	it('reloads quietly and resyncs siblings on clean backup-applied', () => {
		handleCrossTabPolicy({ type: 'backup-applied' }, host);
		expect(vi.mocked(host.reloadQuiet)).toHaveBeenCalledOnce();
		expect(vi.mocked(host.reloadSiblings)).toHaveBeenCalledOnce();
	});

	it('closes a clean remote removal', () => {
		const msg: CrossTabMessage = { type: 'removed', id: 'a' };
		handleCrossTabPolicy(msg, host);
		expect(vi.mocked(host.closeRemoved)).toHaveBeenCalledWith('a');
	});
});
