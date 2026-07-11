import type { FileItem } from './types';
import { checkHandle, getHandle, isFSASupported } from './fsa';

/**
 * Per-file result after checking its disk handle. The store applies
 * `brokenLink` (and resets `linkedToDisk` when the handle disappears entirely)
 * directly on the corresponding `FileItem`.
 */
export interface BrokenLinkUpdate {
	id: string;
	brokenLink: boolean;
	// `null` if the handle no longer exists at all in IDB - in that case the
	// store must also reset `linkedToDisk` to false on the state side. If
	// `false`, we leave `linkedToDisk` as is: the handle exists, only its
	// physical file is problematic.
	handleMissing: boolean;
}

/**
 * Computes the "broken link" state for each file marked `linkedToDisk`. Pure
 * (no side-effect on the files passed as arguments): returns an array of
 * updates that the caller applies to the store. This lets the logic be tested
 * without mounting the full store (which depends on Svelte 5 runes).
 *
 * `getHandleFn` / `checkHandleFn` are injectable to allow mocking in unit tests
 * (jsdom has no FSA, neither does fake-indexeddb). By default we use the real
 * helpers from `./fsa.ts`.
 */
export async function computeBrokenLinks(
	files: ReadonlyArray<FileItem>,
	deps: {
		getHandleFn?: typeof getHandle;
		checkHandleFn?: typeof checkHandle;
	} = {}
): Promise<BrokenLinkUpdate[]> {
	const get = deps.getHandleFn ?? getHandle;
	const check = deps.checkHandleFn ?? checkHandle;
	// Independent checks per file → `Promise.all` to parallelize the
	// `getHandle` + `checkHandle` calls (N×IDB latency otherwise).
	const candidates = files.filter((f) => f.linkedToDisk);
	const updates = await Promise.all(
		candidates.map(async (file): Promise<BrokenLinkUpdate> => {
			const handle = await get(file.id);
			if (!handle) {
				return { id: file.id, brokenLink: true, handleMissing: true };
			}
			const status = await check(handle);
			return {
				id: file.id,
				brokenLink: status === 'broken',
				handleMissing: false
			};
		})
	);
	return updates;
}

/**
 * Short guard that determines whether the environment supports checking FSA
 * handles. Lets callers (the store) avoid useless calls on Firefox / Safari
 * where `linkedToDisk` was never set anyway.
 */
export function canCheckBrokenLinks(): boolean {
	return isFSASupported();
}
