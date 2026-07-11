// §M3 - Cross-tab synchronization (BroadcastChannel).
//
// Two mdsh tabs share the same Dexie base `mdsh`. Without coordination, a tab
// that writes a draft silently overwrites another's write (last-writer-wins),
// and the in-memory store (loaded only once at boot) never resynchronizes →
// invisible data loss.
//
// This module provides a thin and FAIL-SOFT wrapper around `BroadcastChannel`:
//   - `if (browser)` guard + API detection (absent on a few engines);
//   - no exception ever propagated (an unavailable channel does not break the app);
//   - no shared state outside the channel itself.
//
// The POLICY (reload vs notify) lives in `files.svelte.ts`: this module only
// publishes/receives messages. Conservative choice: we never merge automatically
// - we reload a non-dirty draft, we notify a dirty conflict, period.

import { browser } from '$app/environment';

const CHANNEL_NAME = 'mdsh';

/** A draft was (re)written in base by a tab. */
export interface DraftWrittenMessage {
	type: 'draft-written';
	id: string;
	updatedAt: number;
}

/** The order of drafts changed (drag-reorder). */
export interface ReorderMessage {
	type: 'reorder';
}

/** A draft was deleted / moved to the trash. */
export interface RemovedMessage {
	type: 'removed';
	id: string;
}

/** A full backup was restored (all tables rewritten). */
export interface BackupAppliedMessage {
	type: 'backup-applied';
}

export type CrossTabMessage =
	DraftWrittenMessage | ReorderMessage | RemovedMessage | BackupAppliedMessage;

const CROSS_TAB_TYPES = new Set<CrossTabMessage['type']>([
	'draft-written',
	'reorder',
	'removed',
	'backup-applied'
]);

/**
 * Runtime type-guard for a received message: validates the `type` discriminant
 * AND the required payload fields (`id` for draft-written / removed), instead of
 * a simple `typeof type === 'string'`. The channel is same-origin (bounded
 * impact), but we align the static typing with reality - no more `as` assertion.
 */
function isCrossTabMessage(v: unknown): v is CrossTabMessage {
	if (!v || typeof v !== 'object') return false;
	const m = v as Record<string, unknown>;
	if (typeof m.type !== 'string' || !CROSS_TAB_TYPES.has(m.type as CrossTabMessage['type'])) {
		return false;
	}
	if ((m.type === 'draft-written' || m.type === 'removed') && typeof m.id !== 'string') {
		return false;
	}
	return true;
}

/**
 * Creates a cross-tab channel. Returns an object with `post()` / `close()`.
 * `onMessage` receives messages from the OTHER tabs (BroadcastChannel never
 * echoes back to the sender - no reload loop possible).
 *
 * If BroadcastChannel is not available (SSR, old engine, restricted context),
 * returns a no-op: the app works, without cross-tab sync.
 */
export function createCrossTab(onMessage: (msg: CrossTabMessage) => void): {
	post: (msg: CrossTabMessage) => void;
	close: () => void;
} {
	if (!browser || typeof BroadcastChannel === 'undefined') {
		return { post: () => {}, close: () => {} };
	}
	let channel: BroadcastChannel | null = null;
	try {
		channel = new BroadcastChannel(CHANNEL_NAME);
		channel.onmessage = (ev: MessageEvent) => {
			// Defensive guard: we ignore any message in an unexpected format rather
			// than risk an erroneous handling on the store side.
			if (!isCrossTabMessage(ev.data)) return;
			try {
				onMessage(ev.data);
			} catch {
				// A handler that throws must never break the channel.
			}
		};
	} catch {
		// Channel creation impossible: we degrade to a silent no-op.
		return { post: () => {}, close: () => {} };
	}
	return {
		post: (msg) => {
			try {
				channel?.postMessage(msg);
			} catch {
				// `postMessage` can throw if the channel was closed in the meantime.
			}
		},
		close: () => {
			try {
				channel?.close();
			} catch {
				// Ignore: best-effort close.
			}
			channel = null;
		}
	};
}
