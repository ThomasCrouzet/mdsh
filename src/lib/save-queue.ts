// §B3.2 / P2 - Dexie save queue with debounce (400 ms).
//
// Handles the debounce + IDB persistence of drafts. Exports a pure
// `SaveQueue` class (no Svelte runes) that FilesStore instantiates.
// The `$state` mutations (`hasPendingSave`, `lastSavedAt`) are
// delegated via injected callbacks - SaveQueue does not import Svelte.

import { db } from './db';
import type { DraftRow } from './db';
import { TIMERS } from './config';

/** Callbacks to the store's `$state` - injected at construction. */
export interface SaveQueueCallbacks {
	/** Called when the "save in progress" state changes. */
	onPendingChange: (pending: boolean) => void;
	/** Called when an IDB write completes successfully. */
	onSaved: (ts: number) => void;
	/**
	 * Called if an IDB write fails (quota full, IDB unavailable, etc.). Without
	 * this channel, a write failure was swallowed in `console.error` and the UI
	 * always showed "saved" → silent data loss.
	 */
	onError: (err: unknown) => void;
	/**
	 * §M3 - Called after the SUCCESSFUL write of a specific draft (id + updatedAt).
	 * Optional. Used by the store to publish the write to the other tabs
	 * (BroadcastChannel) to avoid silent last-writer-wins.
	 */
	onDraftSaved?: (id: string, updatedAt: number) => void;
}

/**
 * Save queue with per-file debounce. A `schedule(id, getRow)` cancels the
 * previous timer for `id` and reschedules a new one. After 400 ms without a
 * new call, `getRow()` is invoked and the row is written to IDB via
 * `db.drafts.put`.
 *
 * `hasPendingSave` = `saveTimers.size > 0 || pendingWrites > 0`.
 * Without the `pendingWrites` counter, the indicator would fall back to `false`
 * as soon as the timer is cleared, before the IDB write completes.
 */
export class SaveQueue {
	private timers = new Map<string, ReturnType<typeof setTimeout>>();
	private pendingWrites = 0;
	private cb: SaveQueueCallbacks;

	constructor(cb: SaveQueueCallbacks) {
		this.cb = cb;
	}

	private updateFlag(): void {
		this.cb.onPendingChange(this.timers.size > 0 || this.pendingWrites > 0);
	}

	/**
	 * Schedules the write of `id` after `TIMERS.saveDebounceMs`.
	 * `getRow()` is called just before the write - it reads the current state
	 * of the file at flush time (not at schedule time).
	 */
	schedule(id: string, getRow: () => DraftRow | null): void {
		const prev = this.timers.get(id);
		if (prev) clearTimeout(prev);
		this.cb.onPendingChange(true);
		this.timers.set(
			id,
			setTimeout(() => {
				this.timers.delete(id);
				const row = getRow();
				if (!row) {
					this.updateFlag();
					return;
				}
				this.pendingWrites += 1;
				db.drafts
					.put(row)
					.then(() => {
						this.cb.onSaved(Date.now());
						// §M3 - Notifies the other tabs of the successful write.
						this.cb.onDraftSaved?.(row.id, row.updatedAt);
					})
					.catch((err) => this.cb.onError(err))
					.finally(() => {
						this.pendingWrites -= 1;
						this.updateFlag();
					});
			}, TIMERS.saveDebounceMs)
		);
	}

	/**
	 * Cancels a pending timer without writing. Used by `close()` and `reorder()`
	 * to avoid a stale write after the file is removed.
	 */
	cancel(id: string): void {
		const t = this.timers.get(id);
		if (t) {
			clearTimeout(t);
			this.timers.delete(id);
		}
		this.updateFlag();
	}

	/** Cancels all timers without writing (e.g. global reorder). */
	cancelAll(ids: string[]): void {
		for (const id of ids) {
			const t = this.timers.get(id);
			if (t) {
				clearTimeout(t);
				this.timers.delete(id);
			}
		}
		this.updateFlag();
	}

	/**
	 * §M1 - Immediately flushes the pending content of the `ids` that have an armed
	 * timer, without waiting for the debounce. Unlike `cancelAll`, we do NOT forget
	 * the pending keystroke: we write it before forgetting it (otherwise `reorder`
	 * destroyed the timer and lost the last keystroke in base). Used by `reorder`
	 * just before persisting the new `order`.
	 *
	 * Fire-and-forget (consistent with `flush`); the writes are counted in
	 * `pendingWrites` so the "saving" indicator stays accurate.
	 */
	flushPending(ids: string[], getRow: (id: string) => DraftRow | null): void {
		for (const id of ids) {
			const t = this.timers.get(id);
			if (!t) continue;
			clearTimeout(t);
			this.timers.delete(id);
			const row = getRow(id);
			if (!row) continue;
			this.pendingWrites += 1;
			db.drafts
				.put(row)
				.then(() => {
					this.cb.onSaved(Date.now());
					this.cb.onDraftSaved?.(row.id, row.updatedAt);
				})
				.catch((err) => this.cb.onError(err))
				.finally(() => {
					this.pendingWrites -= 1;
					this.updateFlag();
				});
		}
		this.updateFlag();
	}

	/** Indicates whether `id` has a pending timer. */
	has(id: string): boolean {
		return this.timers.has(id);
	}

	/**
	 * §A2.8 - Immediate flush: clears the timers and writes all pending rows.
	 * Called on `pagehide` / `beforeunload`. Fire-and-forget (no `await`) - the
	 * IDB transactions are preserved by Chrome/Firefox even if the page unloads
	 * just after.
	 */
	flush(getRow: (id: string) => DraftRow | null): void {
		if (this.timers.size === 0) return;
		const ids = Array.from(this.timers.keys());
		for (const id of ids) {
			const t = this.timers.get(id);
			if (t) clearTimeout(t);
			this.timers.delete(id);
			const row = getRow(id);
			if (!row) continue;
			// §m3 - `onSaved` ONLY after the write succeeds (like the `schedule`
			// path). Previously `onSaved(Date.now())` was called unconditionally at
			// the end of the loop → the UI could show "saved" while a put failed
			// (invariant "onSaved ⇒ write succeeded" broken). In the unload context
			// the UI disappears, but we keep the consistency for possible
			// non-unload flushes.
			db.drafts
				.put(row)
				.then(() => {
					this.cb.onSaved(Date.now());
					this.cb.onDraftSaved?.(row.id, row.updatedAt);
				})
				.catch((err) => this.cb.onError(err));
		}
		this.updateFlag();
	}
}
