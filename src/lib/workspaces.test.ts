import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, newId, type WorkspaceRow } from './db';

// Test the Dexie persistence layer for the `workspaces` table in schema version 3.
// Do not test the `workspaceStore` singleton because Vitest does not transform
// its `$state` runes without the Svelte plugin. End-to-end tests cover save, load,
// rename, delete, and restoration through filesStore.
// Here, verify the database contract.
// Verify the updatedAt index, fileIds persistence, activeId preservation, and ID lookup.
//
// Lock the schema so a Dexie version change without migration fails immediately.
// The workspaces table and its `updatedAt` index must stay available.

beforeEach(async () => {
	await db.workspaces.clear();
});

afterEach(async () => {
	await db.workspaces.clear();
});

function makeRow(partial: Partial<WorkspaceRow> = {}): WorkspaceRow {
	const now = Date.now();
	return {
		id: partial.id ?? newId(),
		name: partial.name ?? 'Test',
		fileIds: partial.fileIds ?? [],
		activeId: partial.activeId ?? null,
		createdAt: partial.createdAt ?? now,
		updatedAt: partial.updatedAt ?? now
	};
}

describe('db.workspaces - schema v3', () => {
	it('starts empty', async () => {
		const all = await db.workspaces.toArray();
		expect(all).toEqual([]);
	});

	it('persists a workspace with fileIds and activeId', async () => {
		const aId = newId();
		const bId = newId();
		const row = makeRow({
			name: 'Notes meeting',
			fileIds: [aId, bId],
			activeId: aId
		});
		await db.workspaces.put(row);

		const got = await db.workspaces.get(row.id);
		expect(got?.name).toBe('Notes meeting');
		expect(got?.fileIds).toEqual([aId, bId]);
		expect(got?.activeId).toBe(aId);
	});

	it('stores a null activeId for a workspace without an active tab', async () => {
		const row = makeRow({ activeId: null });
		await db.workspaces.put(row);
		const got = await db.workspaces.get(row.id);
		expect(got?.activeId).toBeNull();
	});

	it('lists the latest workspaces first by updatedAt', async () => {
		const r1 = makeRow({ name: 'A', updatedAt: 1000 });
		const r2 = makeRow({ name: 'B', updatedAt: 3000 });
		const r3 = makeRow({ name: 'C', updatedAt: 2000 });
		await db.workspaces.bulkPut([r1, r2, r3]);

		const ordered = await db.workspaces.orderBy('updatedAt').reverse().toArray();
		expect(ordered.map((w) => w.name)).toEqual(['B', 'C', 'A']);
	});

	it('updates an existing workspace with put', async () => {
		const row = makeRow({ name: 'Avant', updatedAt: 1000 });
		await db.workspaces.put(row);

		const updated = { ...row, name: 'Après', updatedAt: 2000 };
		await db.workspaces.put(updated);

		const got = await db.workspaces.get(row.id);
		expect(got?.name).toBe('Après');
		expect(got?.updatedAt).toBe(2000);

		// Keep one entry for the same ID.
		const all = await db.workspaces.toArray();
		expect(all).toHaveLength(1);
	});

	it('removes the entry with delete', async () => {
		const row = makeRow({ name: 'À jeter' });
		await db.workspaces.put(row);
		expect(await db.workspaces.get(row.id)).not.toBeUndefined();

		await db.workspaces.delete(row.id);
		expect(await db.workspaces.get(row.id)).toBeUndefined();
	});

	it('does not throw when delete receives an unknown ID', async () => {
		await expect(db.workspaces.delete('does-not-exist')).resolves.toBeUndefined();
	});

	it('keeps fileIds order for session restoration', async () => {
		const ids = ['z', 'a', 'm', 'b'];
		const row = makeRow({ fileIds: ids });
		await db.workspaces.put(row);
		const got = await db.workspaces.get(row.id);
		// The order matches the tab order in the sidebar.
		expect(got?.fileIds).toEqual(ids);
	});

	it('does not collide with drafts and trashed tables', async () => {
		// Add one row to each table to verify the v3 schema upgrade.
		await db.drafts.put({
			id: 'd1',
			name: 'doc.md',
			content: 'x',
			createdAt: 1,
			updatedAt: 1,
			order: 0
		});
		const wsRow = makeRow({ name: 'Atelier' });
		await db.workspaces.put(wsRow);

		expect(await db.drafts.count()).toBe(1);
		expect(await db.workspaces.count()).toBe(1);
		expect(await db.trashed.count()).toBe(0);

		// Clear drafts to isolate later tests.
		await db.drafts.clear();
	});
});
