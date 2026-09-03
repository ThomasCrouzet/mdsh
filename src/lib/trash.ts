// §P2.8 - Pure trash logic (trash / undo-close).
//
// This module extracts the Dexie operations and the purge timer management from
// FilesStore. No Svelte runes - directly testable via Vitest.
//
// The Svelte state mutations (`files`, `trash`, `activeId`) stay in FilesStore,
// which passes callbacks. This respects the Svelte 5 constraint: `$state` cannot
// live outside the store's init scope.

import { db, newId } from './db';
import type { DraftRow, TrashedRow } from './db';
import type { FileItem, TrashedFile } from './types';
import { TIMERS } from './config';
import { deleteHandle } from './fsa';
import { reportPersistenceError } from './storage';
import { reportError } from './report';
import { uniqueName } from './file-utils';

/**
 * Complete and symmetric purge of a file leaving the trash: removes the
 * `trashed` row, the FSA handle and the entire version history (key `draftId`
 * === id). Used by both purge paths (the store's timer + purge of expired
 * entries on a late reload) so no snapshot orphans the storage.
 */
async function fullPurge(id: string): Promise<void> {
	const hasDraft = await db.transaction('rw', db.drafts, db.trashed, db.versions, async () => {
		const current = await db.drafts.get(id);
		await db.trashed.delete(id);
		if (!current) await db.versions.where('draftId').equals(id).delete();
		return Boolean(current);
	});
	if (!hasDraft)
		await deleteHandle(id).catch((err) => reportError('suppression du lien disque', err));
}

async function preserveCurrentVariant(
	id: string,
	replacement: DraftRow
): Promise<DraftRow | undefined> {
	const current = await db.drafts.get(id);
	if (!current || (current.name === replacement.name && current.content === replacement.content))
		return;
	const documents = await db.drafts.toArray();
	const preserved = {
		...current,
		id: newId(),
		name: uniqueName(
			documents.map((document) => document.name),
			current.name
		),
		order: documents.reduce((max, document) => Math.max(max, document.order), -1) + 1,
		open: false
	};
	await db.drafts.put(preserved);
	await copyVersionHistory(id, preserved.id);
	return preserved;
}

async function copyVersionHistory(sourceId: string, targetId: string): Promise<void> {
	const versions = await db.versions.where('draftId').equals(sourceId).toArray();
	await db.versions.bulkPut(
		versions.map((version) => ({ ...version, id: newId(), draftId: targetId }))
	);
}

/** Preserves a trash entry before reusing its id. Must run inside the caller transaction. */
export async function preserveTrashEntry(id: string): Promise<TrashedRow | undefined> {
	const previous = await db.trashed.get(id);
	if (!previous) return;
	const preservedId = newId();
	const preserved = { ...previous, id: preservedId, file: { ...previous.file, id: preservedId } };
	await db.trashed.put(preserved);
	await copyVersionHistory(id, preservedId);
	return preserved;
}

// ─── Types ───────────────────────────────────────────────────────────────────

/** Result of loading a trash entry from Dexie. */
export interface TrashLoadResult {
	entry: TrashedFile;
	/** Time remaining before automatic purge (ms). */
	remainingMs: number;
}

// ─── Low-level functions (pure / testable) ─────────────────────────────

/**
 * Reads the `trashed` table from Dexie and computes, for each entry, the time
 * remaining before automatic purge.
 *
 * Returns only the entries still within the undo window. The expired entries
 * are deleted from Dexie in place (DB side-effect, no Svelte state).
 */
export async function loadTrashRows(now = Date.now()): Promise<TrashLoadResult[]> {
	const trashedRows = await db.trashed.orderBy('trashedAt').toArray();
	const results: TrashLoadResult[] = [];
	for (const tr of trashedRows) {
		const remainingMs = TIMERS.trashRetentionMs - (now - tr.trashedAt);
		if (remainingMs <= 0) {
			// Immediate purge: undo window expired (late reload). Complete purge
			// (trashed + handle + versions) so no orphan snapshots are left in base.
			try {
				await fullPurge(tr.id);
				continue;
			} catch (error) {
				reportPersistenceError(error, 'trash');
			}
		}
		const file: FileItem = {
			id: tr.file.id,
			name: tr.file.name,
			content: tr.file.content,
			createdAt: tr.file.createdAt,
			updatedAt: tr.file.updatedAt,
			dirty: false,
			linkedToDisk: false
		};
		results.push({ entry: { file, order: tr.order, trashedAt: tr.trashedAt }, remainingMs });
	}
	return results;
}

/**
 * Moves a file from `drafts` to `trashed` in a single Dexie transaction. No
 * effect on the Svelte state - the store updates `this.trash` separately.
 * Returns `true` if the transaction succeeded, `false` otherwise (the store then
 * cancels its optimistic mutation so the UI does not lie about a failed write).
 */
export async function moveToTrash(
	id: string,
	draftRow: DraftRow,
	order: number,
	trashedAt: number,
	onPreserved?: (row: TrashedRow) => void,
	onVariantPreserved?: (row: DraftRow) => void
): Promise<boolean> {
	const row: TrashedRow = { id, file: draftRow, order, trashedAt };
	let preserved: TrashedRow | undefined;
	let variant: DraftRow | undefined;
	try {
		await db.transaction('rw', db.drafts, db.trashed, db.versions, async () => {
			variant = await preserveCurrentVariant(id, draftRow);
			preserved = await preserveTrashEntry(id);
			await db.drafts.delete(id);
			await db.trashed.put(row);
		});
		if (preserved) onPreserved?.(preserved);
		if (variant) onVariantPreserved?.(variant);
		return true;
	} catch (err) {
		reportPersistenceError(err, 'trash');
		return false;
	}
}

/**
 * Restores a file from the trash atomically: rewrites the `drafts` row AND
 * deletes the `trashed` entry in a single transaction. Without this atomicity, a
 * crash / an eviction between the two left the file in NO table (data loss in
 * the debounce window). Returns `true` if the transaction succeeded.
 */
export async function restoreFromTrash(
	id: string,
	draftRow: DraftRow,
	onPreserved?: (row: DraftRow) => void
): Promise<boolean> {
	let preserved: DraftRow | undefined;
	try {
		await db.transaction('rw', db.drafts, db.trashed, db.versions, async () => {
			preserved = await preserveCurrentVariant(draftRow.id, draftRow);
			if (draftRow.id !== id) await copyVersionHistory(id, draftRow.id);
			await db.drafts.put(draftRow);
			await db.trashed.delete(id);
		});
		if (preserved) onPreserved?.(preserved);
		return true;
	} catch (err) {
		reportPersistenceError(err, 'save');
		return false;
	}
}

/**
 * Permanent purge of a trash entry (undo timer expired): removes from Dexie,
 * deletes the possible FSA handle and the version history. The store has already
 * removed the entry from `this.trash`.
 */
export async function purgePermanently(id: string): Promise<void> {
	await fullPurge(id);
}

/**
 * Persists the new order of all files after a drag-reorder. Single Dexie
 * transaction - `update` only touches the `order` field (no rewrite of the full
 * content).
 *
 * @param orderedIds - ids in the new order (index = Dexie order).
 * @returns `Date.now()` at commit, or `null` if the transaction failed (so the
 *   store does NOT show "saved" on a non-persisted order).
 */
export async function persistReorder(orderedIds: string[]): Promise<number | null> {
	try {
		await db.transaction('rw', db.drafts, async () => {
			await Promise.all(orderedIds.map((id, idx) => db.drafts.update(id, { order: idx })));
		});
		return Date.now();
	} catch (err) {
		reportPersistenceError(err, 'reorder');
		return null;
	}
}
