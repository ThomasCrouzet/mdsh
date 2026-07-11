// §1.3 - Centralized error logging.
//
// Single entry point for all non-fatal errors/warnings of the app. Replaces the
// scattered `console.error` / `console.warn` (files, exports, front-matter,
// image drag-drop…). Goal: a single place decides
//   - what is logged to the console (always, for debugging);
//   - what surfaces to the user via a toast (`notify`), when it is actionable
//     on their side.
//
// No telemetry: consistent with the project's "zero network, zero tracking"
// posture. `report.ts` never sends anything - it routes between `console` and
// `notify` (local toasts), full stop.
//
// Note: IndexedDB persistence keeps its dedicated helper
// `reportPersistenceError` (storage.ts) which finely maps quota/write failure →
// message; `report*` covers everything else.

import { notify } from './notify.svelte';

export interface ReportOptions {
	/**
	 * Message presented to the user via a toast. Absent ⇒ error logged to the
	 * console only (no visual interruption).
	 */
	notifyUser?: string;
	/** Toast level (default `error`). `info` for a non-blocking warning. */
	level?: 'error' | 'info';
}

/**
 * Logs an error (always to the console, prefixed `[mdsh] <scope>`) and, if
 * `notifyUser` is provided, drops a toast for the user.
 *
 * @param scope  Short, stable context (e.g. `export ZIP`, `chargement IndexedDB`).
 * @param err    The captured error (or any thrown value).
 */
export function reportError(scope: string, err: unknown, opts: ReportOptions = {}): void {
	console.error(`[mdsh] ${scope} :`, err);
	if (opts.notifyUser) {
		if (opts.level === 'info') notify.info(opts.notifyUser);
		else notify.error(opts.notifyUser);
	}
}

/**
 * Logs a non-fatal warning (console only). For the cases "we ignore cleanly and
 * continue" (invalid front-matter YAML, oversized image skipped…). Never
 * surfaces a toast - discreet usage.
 *
 * @param scope   Short context.
 * @param detail  Optional detail (message, value) attached to the log.
 */
export function reportWarning(scope: string, detail?: unknown): void {
	if (detail !== undefined) console.warn(`[mdsh] ${scope} :`, detail);
	else console.warn(`[mdsh] ${scope}`);
}
