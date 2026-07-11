// §2.4 - Local version history.
//
// The save (400 ms debounce) overwrites the previous content; beyond the session
// undo, nothing allows going back. This module captures timestamped snapshots in
// `db.versions`, throttled and deduplicated so as not to blow up the storage,
// with purge by recency + age.
//
// Everything is local (Dexie) - no network. Pure logic + db access, testable.

import Dexie from 'dexie';
import { db, newId, type VersionRow } from './db';

export const VERSION_LIMITS = {
	/** Max number of versions kept per file. */
	maxPerDraft: 30,
	/** Max age of a version (ms) - 30 days. */
	maxAgeMs: 30 * 24 * 60 * 60 * 1000,
	/** Min interval between two snapshots of the same file (ms) - 5 min. */
	minIntervalMs: 5 * 60 * 1000
} as const;

export interface SnapshotInput {
	id: string;
	name: string;
	content: string;
}

/**
 * Records a snapshot of the file, IF relevant:
 *   - non-empty content;
 *   - different from the last snapshot (no duplicate);
 *   - last snapshot older than `minIntervalMs` (throttle).
 * Then purges the file's history. Returns `true` if a snapshot was written.
 * Fire-and-forget on the caller side (does not block the save).
 */
export async function recordVersion(draft: SnapshotInput, now = Date.now()): Promise<boolean> {
	if (!draft.content.trim()) return false;
	// rw transaction: the sequence read (last snapshot) → throttle/dedup decision
	// → write → purge is atomic. Without it, two concurrent flushes of the same
	// file read the same "last" and wrote two near-identical snapshots.
	return db.transaction('rw', db.versions, async () => {
		// Reads only the most recent snapshot via the composite index
		// [draftId+createdAt], instead of loading the whole file history on every
		// save flush (the throttle/dedup decision only looks at it).
		const last = await db.versions
			.where('[draftId+createdAt]')
			.between([draft.id, Dexie.minKey], [draft.id, Dexie.maxKey])
			.last();
		if (last) {
			if (last.content === draft.content) return false;
			if (now - last.createdAt < VERSION_LIMITS.minIntervalMs) return false;
		}
		const row: VersionRow = {
			id: newId(),
			draftId: draft.id,
			name: draft.name,
			content: draft.content,
			createdAt: now
		};
		await db.versions.put(row);
		await pruneVersions(draft.id, now);
		return true;
	});
}

/**
 * Purges a file's history: deletes versions that are too old (`maxAgeMs`) then,
 * among those remaining, keeps only the `maxPerDraft` most recent ones. Returns
 * the number of versions deleted.
 */
export async function pruneVersions(draftId: string, now = Date.now()): Promise<number> {
	const all = await db.versions.where('draftId').equals(draftId).sortBy('createdAt'); // asc
	const toDelete: string[] = [];
	const survivors: VersionRow[] = [];
	for (const v of all) {
		if (now - v.createdAt > VERSION_LIMITS.maxAgeMs) toDelete.push(v.id);
		else survivors.push(v);
	}
	if (survivors.length > VERSION_LIMITS.maxPerDraft) {
		const excess = survivors.slice(0, survivors.length - VERSION_LIMITS.maxPerDraft);
		for (const v of excess) toDelete.push(v.id);
	}
	if (toDelete.length > 0) await db.versions.bulkDelete(toDelete);
	return toDelete.length;
}

/** Lists a file's versions, most recent first. */
export async function listVersions(draftId: string): Promise<VersionRow[]> {
	const all = await db.versions.where('draftId').equals(draftId).sortBy('createdAt');
	return all.reverse();
}

/** Deletes a file's entire history (called on the permanent deletion of the draft). */
export async function deleteVersionsFor(draftId: string): Promise<void> {
	await db.versions.where('draftId').equals(draftId).delete();
}

/**
 * "Light" diff: counts the lines added / removed between two contents, by
 * line multiset (not a real LCS - O(n) memory, sufficient for a "+X / -Y"
 * indicator in the history, without a heavy diff lib).
 */
export function lineDiffStats(from: string, to: string): { added: number; removed: number } {
	const count = (s: string): Map<string, number> => {
		const m = new Map<string, number>();
		for (const line of s.split('\n')) m.set(line, (m.get(line) ?? 0) + 1);
		return m;
	};
	const a = count(from);
	const b = count(to);
	let added = 0;
	let removed = 0;
	for (const [line, n] of b) {
		const d = n - (a.get(line) ?? 0);
		if (d > 0) added += d;
	}
	for (const [line, n] of a) {
		const d = n - (b.get(line) ?? 0);
		if (d > 0) removed += d;
	}
	return { added, removed };
}
