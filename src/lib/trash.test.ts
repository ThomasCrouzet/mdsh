import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from './db';
import type { DraftRow, TrashedRow } from './db';
import { TIMERS } from './config';
import {
	loadTrashRows,
	moveToTrash,
	restoreFromTrash,
	purgePermanently,
	persistReorder
} from './trash';
import { recordVersion } from './version-history';

// Use a fixed epoch timestamp to make undo calculations deterministic.
const T0 = 1_000_000_000_000;

/** Fabrique une row `drafts` minimale. */
function draftRow(id: string, order = 0): DraftRow {
	return {
		id,
		name: `${id}.md`,
		content: `contenu ${id}`,
		createdAt: T0,
		updatedAt: T0,
		order
	};
}

/** Fabrique une row `trashed` minimale. */
function trashedRow(id: string, trashedAt: number, order = 0): TrashedRow {
	return { id, file: draftRow(id, order), order, trashedAt };
}

beforeEach(async () => {
	await db.drafts.clear();
	await db.trashed.clear();
	await db.versions.clear();
});
afterEach(async () => {
	vi.restoreAllMocks();
	await db.drafts.clear();
	await db.trashed.clear();
	await db.versions.clear();
});

describe('loadTrashRows', () => {
	it('returns an empty array for empty trash', async () => {
		expect(await loadTrashRows(T0)).toEqual([]);
	});

	it('keeps an entry during the undo period with exact remainingMs', async () => {
		// The item entered the trash 2000 ms ago, so 5000 - 2000 = 3000 ms remain.
		await db.trashed.put(trashedRow('keep', T0 - 2000, 1));
		const now = T0;

		const results = await loadTrashRows(now);

		expect(results).toHaveLength(1);
		expect(results[0]!.remainingMs).toBe(TIMERS.trashRetentionMs - 2000); // 3000
		expect(results[0]!.entry.order).toBe(1);
		expect(results[0]!.entry.trashedAt).toBe(T0 - 2000);
		// The database entry is still present.
		expect(await db.trashed.get('keep')).toBeTruthy();
	});

	it('rebuilds FileItem from the stored row with reset state', async () => {
		await db.trashed.put(trashedRow('f1', T0 - 1000, 3));

		const { entry } = (await loadTrashRows(T0))[0]!;

		expect(entry.file).toEqual({
			id: 'f1',
			name: 'f1.md',
			content: 'contenu f1',
			createdAt: T0,
			updatedAt: T0,
			dirty: false,
			linkedToDisk: false
		});
	});

	it('deletes an expired entry from the database and result', async () => {
		// The item entered the trash exactly trashRetentionMs ago, so remainingMs = 0 and it is purged.
		await db.trashed.put(trashedRow('expired', T0 - TIMERS.trashRetentionMs, 0));

		const results = await loadTrashRows(T0);

		expect(results).toEqual([]);
		expect(await db.trashed.get('expired')).toBeUndefined();
	});

	it('deletes an old entry and keeps a recent entry', async () => {
		await db.trashed.bulkPut([
			trashedRow('old', T0 - TIMERS.trashRetentionMs - 10_000, 0),
			trashedRow('fresh', T0 - 1000, 1)
		]);

		const results = await loadTrashRows(T0);

		expect(results.map((r) => r.entry.file.id)).toEqual(['fresh']);
		expect(results[0]!.remainingMs).toBe(TIMERS.trashRetentionMs - 1000); // 4000
		expect(await db.trashed.get('old')).toBeUndefined();
		expect(await db.trashed.get('fresh')).toBeTruthy();
	});

	it('returns entries in ascending trashedAt order', async () => {
		await db.trashed.bulkPut([
			trashedRow('b', T0 - 1000, 0),
			trashedRow('a', T0 - 3000, 1),
			trashedRow('c', T0 - 2000, 2)
		]);

		const results = await loadTrashRows(T0);

		// orderBy('trashedAt') gives 'a' (-3000), then 'c' (-2000), then 'b' (-1000).
		expect(results.map((r) => r.entry.file.id)).toEqual(['a', 'c', 'b']);
	});
});

describe('moveToTrash', () => {
	it('moves a file from drafts to trashed in one transaction', async () => {
		await db.drafts.put(draftRow('d1', 2));
		const row = await db.drafts.get('d1');
		expect(row).toBeTruthy();

		const ok = await moveToTrash('d1', row!, 2, T0);

		expect(ok).toBe(true);
		expect(await db.drafts.get('d1')).toBeUndefined();
		const trashed = await db.trashed.get('d1');
		expect(trashed).toEqual({ id: 'd1', file: row, order: 2, trashedAt: T0 });
	});

	it('does not change other drafts', async () => {
		await db.drafts.bulkPut([draftRow('d1', 0), draftRow('d2', 1)]);

		await moveToTrash('d1', draftRow('d1', 0), 0, T0);

		expect(await db.drafts.get('d2')).toBeTruthy();
		expect(await db.drafts.count()).toBe(1);
		expect(await db.trashed.count()).toBe(1);
	});

	it('reloads a moved file through loadTrashRows', async () => {
		await db.drafts.put(draftRow('rt', 0));
		await moveToTrash('rt', draftRow('rt', 0), 0, T0 - 500);

		const results = await loadTrashRows(T0);

		expect(results).toHaveLength(1);
		expect(results[0]!.entry.file.id).toBe('rt');
		expect(results[0]!.remainingMs).toBe(TIMERS.trashRetentionMs - 500); // 4500
	});
});

describe('restoreFromTrash', () => {
	it('keeps a durable variant when the same ID exists', async () => {
		await db.trashed.put(trashedRow('r', T0));
		await db.drafts.put({ ...draftRow('r'), content: 'nouvelle branche' });
		await restoreFromTrash('r', draftRow('r'));
		expect((await db.drafts.get('r'))?.content).toBe('contenu r');
		const variant = (await db.drafts.toArray()).find((row) => row.id !== 'r');
		expect(variant?.content).toBe('nouvelle branche');
		expect(variant?.open).toBe(false);
	});

	it('writes the draft row and deletes the trash row in one transaction', async () => {
		await db.trashed.put(trashedRow('r1', T0, 0));
		const row = draftRow('r1', 0);

		const ok = await restoreFromTrash('r1', row);

		expect(ok).toBe(true);
		expect(await db.trashed.get('r1')).toBeUndefined();
		expect(await db.drafts.get('r1')).toEqual(row);
	});

	it('keeps the file in a table during restore', async () => {
		await db.trashed.put(trashedRow('r2', T0, 1));
		await restoreFromTrash('r2', draftRow('r2', 1));
		// The entry leaves trashed and exists in drafts without a gap.
		expect(await db.drafts.count()).toBe(1);
		expect(await db.trashed.count()).toBe(0);
	});
});

describe('purgePermanently', () => {
	it('keeps history for a live document with the same ID', async () => {
		await db.trashed.put(trashedRow('shared', T0));
		await db.drafts.put(draftRow('shared'));
		await recordVersion({ id: 'shared', name: 'shared.md', content: 'vivant' }, T0);
		await purgePermanently('shared');
		expect(await db.trashed.get('shared')).toBeUndefined();
		expect(await db.versions.where('draftId').equals('shared').count()).toBe(1);
	});

	it('deletes the trash entry permanently', async () => {
		await db.trashed.bulkPut([trashedRow('p1', T0, 0), trashedRow('p2', T0, 1)]);

		await purgePermanently('p1');

		expect(await db.trashed.get('p1')).toBeUndefined();
		expect(await db.trashed.get('p2')).toBeTruthy();
		expect(await db.trashed.count()).toBe(1);
	});

	it('also deletes file history without orphan snapshots', async () => {
		await db.trashed.put(trashedRow('p3', T0, 0));
		await recordVersion({ id: 'p3', name: 'p3.md', content: 'du contenu' }, T0);
		expect(await db.versions.where('draftId').equals('p3').count()).toBe(1);

		await purgePermanently('p3');

		expect(await db.trashed.get('p3')).toBeUndefined();
		expect(await db.versions.where('draftId').equals('p3').count()).toBe(0);
	});

	it('does nothing for an unknown ID', async () => {
		await expect(purgePermanently('ghost')).resolves.toBeUndefined();
		expect(await db.trashed.count()).toBe(0);
	});
});

describe('persistReorder', () => {
	it('writes each draft order from its array index', async () => {
		await db.drafts.bulkPut([draftRow('a', 0), draftRow('b', 1), draftRow('c', 2)]);

		// Set the new order to c, a, b, with order values 0, 1, and 2.
		await persistReorder(['c', 'a', 'b']);

		expect((await db.drafts.get('c'))!.order).toBe(0);
		expect((await db.drafts.get('a'))!.order).toBe(1);
		expect((await db.drafts.get('b'))!.order).toBe(2);
	});

	it('changes only order and keeps content and name', async () => {
		await db.drafts.put(draftRow('a', 5));

		await persistReorder(['a']);

		const row = await db.drafts.get('a');
		expect(row).toEqual({
			id: 'a',
			name: 'a.md',
			content: 'contenu a',
			createdAt: T0,
			updatedAt: T0,
			order: 0
		});
	});

	it('returns a timestamp at or after the call time', async () => {
		await db.drafts.put(draftRow('a', 0));
		const before = Date.now();

		const ts = await persistReorder(['a']);

		expect(ts).toBeGreaterThanOrEqual(before);
		expect(ts).toBeLessThanOrEqual(Date.now());
	});

	it('ignores an unknown ID in the list', async () => {
		await db.drafts.put(draftRow('a', 0));

		// Dexie update returns zero changed rows without an error for unknown `ghost`.
		await expect(persistReorder(['ghost', 'a'])).resolves.toBeGreaterThan(0);
		expect((await db.drafts.get('a'))!.order).toBe(1);
		expect(await db.drafts.get('ghost')).toBeUndefined();
	});
});

describe('trash persistence failures and conflicts', () => {
	it('keeps both branches when deletion meets a remote write', async () => {
		await db.drafts.put({ ...draftRow('same'), content: 'remote' });
		expect(await moveToTrash('same', { ...draftRow('same'), content: 'local' }, 0, T0)).toBe(true);
		expect((await db.trashed.get('same'))?.file.content).toBe('local');
		expect(await db.drafts.toArray()).toEqual([
			expect.objectContaining({ content: 'remote', open: false })
		]);
	});
	it('keeps the current branch before trash restoration', async () => {
		await db.drafts.put({ ...draftRow('same'), content: 'remote' });
		await db.trashed.put(trashedRow('same', T0));
		expect(await restoreFromTrash('same', draftRow('same'))).toBe(true);
		expect((await db.drafts.toArray()).map((row) => row.content).sort()).toEqual([
			'contenu same',
			'remote'
		]);
	});
	it('cancels all deletion when the trash transaction fails', async () => {
		await db.drafts.put(draftRow('safe'));
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(db.trashed, 'put').mockRejectedValue(new Error('quota'));
		expect(await moveToTrash('safe', draftRow('safe'), 0, T0)).toBe(false);
		expect(await db.drafts.get('safe')).toBeDefined();
	});
	it('keeps the trash entry when restoration fails', async () => {
		await db.trashed.put(trashedRow('safe', T0));
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(db.drafts, 'put').mockRejectedValue(new Error('quota'));
		expect(await restoreFromTrash('safe', draftRow('safe'))).toBe(false);
		expect(await db.trashed.get('safe')).toBeDefined();
	});
	it('keeps a failed expired purge recoverable during load', async () => {
		await db.trashed.put(trashedRow('safe', T0));
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(db.trashed, 'delete').mockRejectedValue(new Error('storage'));
		const result = await loadTrashRows(T0 + TIMERS.trashRetentionMs + 1);
		expect(result.map((row) => row.entry.file.id)).toEqual(['safe']);
		expect(await db.trashed.get('safe')).toBeDefined();
	});
	it('does not return a false timestamp after reorder failure', async () => {
		await db.drafts.put(draftRow('safe'));
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(db.drafts, 'update').mockRejectedValue(new Error('storage'));
		expect(await persistReorder(['safe'])).toBeNull();
	});
	it('keeps history and a live document that share the purged ID', async () => {
		await db.drafts.put(draftRow('safe'));
		await db.trashed.put(trashedRow('safe', T0));
		await recordVersion({ id: 'safe', name: 'safe.md', content: 'history' }, T0);
		await purgePermanently('safe');
		expect(await db.drafts.get('safe')).toBeDefined();
		expect(await db.versions.where('draftId').equals('safe').count()).toBe(1);
	});
});
