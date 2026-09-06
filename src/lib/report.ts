// §1.3 - Centralized error logging.
//
// Single entry point for all nonfatal app errors and warnings. It replaces
// separate console calls in file, export, front-matter, and image-drop code.
// Always log for debugging. Show a toast only when the user can act on it.
//
// Do not send telemetry. This module only routes messages to the console and
// local notification toasts.
//
// IndexedDB persistence uses `reportPersistenceError` in storage.ts. That helper
// maps quota and write failures to messages. The functions here handle other errors.

import { notify } from './notify.svelte';

export interface ReportOptions {
	/**
	 * Message to show in a toast. If absent, log only to the console.
	 */
	notifyUser?: string;
	/** Toast level (default `error`). `info` for a non-blocking warning. */
	level?: 'error' | 'info';
}

/**
 * Logs an error with a `[mdsh] <scope>` prefix. Shows a toast when
 * `notifyUser` is present.
 *
 * @param scope  Short, stable context, for example `export ZIP` or `load IndexedDB`.
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
 * Logs a nonfatal warning to the console. Use it when the app can safely
 * continue, such as after invalid YAML or an oversized image.
 *
 * @param scope   Short context.
 * @param detail  Optional detail (message, value) attached to the log.
 */
export function reportWarning(scope: string, detail?: unknown): void {
	if (detail !== undefined) console.warn(`[mdsh] ${scope} :`, detail);
	else console.warn(`[mdsh] ${scope}`);
}
