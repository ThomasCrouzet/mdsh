import { browser } from '$app/environment';

/**
 * Desktop shell detection (Tauri 2).
 *
 * Prefer `import.meta.env.TAURI_ENV_PLATFORM` when present (injected by the
 * Tauri CLI during `tauri dev` / `tauri build`). Fall back to the runtime
 * globals Tauri injects into the webview so a production web build that
 * never saw those env vars still detects the shell if opened inside it.
 *
 * Pure, no `@tauri-apps/*` import: keeps Tauri out of the GH Pages boot graph
 * and the size-limit budget. Native APIs must be loaded via dynamic `import()`
 * from desktop-only call sites.
 */
export function isDesktop(): boolean {
	if (!browser) return false;
	// Vite / Tauri inject this for both dev and production desktop builds.
	const platform = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
		?.TAURI_ENV_PLATFORM;
	if (typeof platform === 'string' && platform.length > 0) return true;
	const w = window as Window & {
		__TAURI_INTERNALS__?: unknown;
		isTauri?: boolean;
	};
	return w.isTauri === true || typeof w.__TAURI_INTERNALS__ !== 'undefined';
}
