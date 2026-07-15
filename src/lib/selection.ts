// Pure multi-selection helpers for the sidebar (§6.5).
//
// Extracted from `files.svelte.ts` so toggle / range logic is unit-testable
// without mounting the Svelte 5 store. Callers always reassign a fresh `Set`
// (Svelte 5 does not track in-place mutations of `$state` collections).

/**
 * Cmd/Ctrl+click: add or remove `id` from the selection.
 * Returns a new Set (never mutates `selected`).
 */
export function toggleSelection(selected: ReadonlySet<string>, id: string): Set<string> {
	const next = new Set(selected);
	if (next.has(id)) next.delete(id);
	else next.add(id);
	return next;
}

/**
 * Shift+click: select the inclusive range between `anchorId` and `targetId`
 * in the ordered `ids` list (sidebar tab order). Existing selection is kept
 * and unioned with the range. Unknown ids are a no-op (returns a copy).
 */
export function rangeSelection(
	selected: ReadonlySet<string>,
	ids: readonly string[],
	anchorId: string,
	targetId: string
): Set<string> {
	const fromIdx = ids.indexOf(anchorId);
	const toIdx = ids.indexOf(targetId);
	if (fromIdx === -1 || toIdx === -1) return new Set(selected);
	const [lo, hi] = fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
	const next = new Set(selected);
	for (let i = lo; i <= hi; i++) next.add(ids[i]!);
	return next;
}

/** Empty selection. */
export function clearSelection(): Set<string> {
	return new Set();
}
