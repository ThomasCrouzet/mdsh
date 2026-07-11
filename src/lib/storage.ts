// §J1 - Local storage resilience (IndexedDB).
//
// The app persists EVERYTHING in IndexedDB (drafts, trash, workspaces) - no
// backend, no network fallback. So it is a single point of failure that we
// harden here:
//   - `isQuotaError`        : detects a quota overflow (cross-browser).
//   - `reportPersistenceError` : routes a write error to a user toast
//                             instead of swallowing it in the console.
//   - `requestPersistentStorage` : requests a persistent bucket so the
//                             browser does not evict the data under disk
//                             pressure (without it, IDB is "best-effort").
//   - `checkStoragePressure` : preemptive alert before the quota is reached.
//
// Acute motivation: since image drag & drop (inline data-URI in the markdown
// content), a draft can weigh several MB - the quota becomes reachable, and a
// silent failure = invisible data loss.

import { browser } from '$app/environment';
import { t } from '$lib/i18n';
import { notify } from './notify.svelte';

/** Context of a storage operation, for a tailored error message. */
export type PersistenceContext = 'save' | 'trash' | 'reorder' | 'delete' | 'load';

/** Detects a storage quota overflow, across all browsers. */
export function isQuotaError(err: unknown): boolean {
	if (err instanceof DOMException) {
		return (
			err.name === 'QuotaExceededError' ||
			// Historical Firefox.
			err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
			err.code === 22
		);
	}
	return false;
}

/**
 * Routes a persistence error to a visible user notification.
 * Distinguishes a full quota (actionable: export / close files) from a generic
 * failure. The toast is deduplicated on the `notify` side - no avalanche if
 * every write fails (the typical case when the quota is reached).
 */
export function reportPersistenceError(err: unknown, context: PersistenceContext): void {
	if (isQuotaError(err)) {
		notify.error(t('storage.quotaFull'));
	} else {
		notify.error(
			context === 'save'
				? t('storage.saveFailed')
				: context === 'load'
					? t('storage.loadFailed')
					: t('storage.genericFailed')
		);
	}
	console.error(`[mdsh] persistance (${context}) :`, err);
}

/**
 * Asks the browser for persistent storage (best-effort, idempotent).
 * Without a persistent bucket, IndexedDB can be purged under disk pressure - for
 * an app whose sole storage this is, we want the persistent mode.
 * Returns `true` if granted (or already granted), `false` otherwise.
 */
export async function requestPersistentStorage(): Promise<boolean> {
	if (!browser) return false;
	const storage = navigator.storage;
	if (!storage?.persist) return false;
	try {
		if (storage.persisted && (await storage.persisted())) return true;
		return await storage.persist();
	} catch {
		return false;
	}
}

/**
 * Checks storage pressure and alerts (info toast) if usage exceeds `threshold`
 * (fraction 0..1) of the quota. No-op if the `estimate` API is unavailable or
 * fails (private mode). To be called at startup, after the load.
 */
export async function checkStoragePressure(threshold = 0.85): Promise<void> {
	if (!browser) return;
	const storage = navigator.storage;
	if (!storage?.estimate) return;
	try {
		const { usage, quota } = await storage.estimate();
		if (!usage || !quota) return;
		if (usage / quota >= threshold) {
			const pct = Math.round((usage / quota) * 100);
			notify.info(t('storage.pressureWarning', { pct }));
		}
	} catch {
		// estimate() can throw in private browsing - best-effort, silent.
	}
}
