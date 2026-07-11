// §P2.5 - Module for adaptive prefetch of the heavy chunks.
//
// Pure logic with no $effect or $state - no factory needed.
// To call from onMount (browser only) after filesStore.load().
//
// Logic extracted from `+page.svelte` (L268-332).
//
// IMPORTANT: the dynamic imports of this module must stay dynamic
// (no-restricted-imports guard against bundle regression).

export interface PrefetchOptions {
	// Current edit mode at prefetch time (influences the CodeMirror skip)
	getMode: () => string;
	// Open files (for the math heuristic)
	getFiles: () => Array<{ content: string }>;
}

/**
 * §A3.2 / A5.1 - Adaptive prefetch: once the browser is idle *and* a minimum
 * delay has elapsed, preloads the heavy libs the user is likely to
 * trigger (markdown renderer, CodeMirror if in source mode). The min
 * delay prevents the chunk parse/eval (~100 ms) from landing during an
 * early interaction (resize drag, fast typing). Lazy chunks, so zero
 * impact on the critical path.
 *
 * §A5.1 - Adaptive delay: on a low-end device (deviceMemory < 4 GB) or
 * with Save-Data enabled, we delay + skip CodeMirror if not in source
 * mode. On a beefy desktop, we prefetch earlier and more broadly.
 */
export function schedulePrefetch(opts: PrefetchOptions): void {
	const win = window as Window & {
		requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
	};
	const nav = navigator as Navigator & {
		deviceMemory?: number;
		connection?: { saveData?: boolean; effectiveType?: string };
	};
	const lowEnd =
		(typeof nav.deviceMemory === 'number' && nav.deviceMemory < 4) ||
		nav.connection?.saveData === true ||
		nav.connection?.effectiveType === '2g' ||
		nav.connection?.effectiveType === 'slow-2g';
	const prefetchDelay = lowEnd ? 6000 : 2500;

	const prefetchMarkdown = () => {
		void import('$lib/render/markdown').catch(() => {});
	};

	// §A3.2 - Also prefetch CodeMirror if:
	//   - device is not low-end (otherwise avoid wasting RAM/CPU)
	//   - source mode active OR no persisted mode (1st visit: 50/50)
	const prefetchSource = () => {
		if (lowEnd && opts.getMode() !== 'source') return;
		void Promise.all([
			import('@codemirror/state'),
			import('@codemirror/view'),
			import('@codemirror/lang-markdown'),
			import('@codemirror/commands'),
			import('@codemirror/language'),
			import('@codemirror/search')
		]).catch(() => {});
	};

	// §A3.3 - Math heuristic: if any file contains `$$..$$` or `$..$`, we
	// bump the markdown prefetch: dynamically importing
	// `$lib/render/markdown` loads the KaTeX CSS (`import 'katex/dist/...`)
	// which in turn resolves the fonts via their relative `url(...)`.
	// Everything then goes through the SW runtimeCaching. No hardcoded
	// hash, no absolute path broken under BASE_PATH=/mdsh.
	const hasMath = () =>
		opts.getFiles().some((f) => /\$\$[\s\S]+?\$\$|\$(?!\s)[^\n$]+?\$/.test(f.content));

	const scheduleIdle = (cb: () => void, idleTimeout = 5000) => {
		if (win.requestIdleCallback) {
			win.requestIdleCallback(cb, { timeout: idleTimeout });
		} else {
			cb();
		}
	};

	setTimeout(() => {
		// Markdown renderer: prioritized if math is detected (forces a short idle).
		scheduleIdle(prefetchMarkdown, hasMath() ? 2000 : 5000);
		scheduleIdle(prefetchSource, 8000);
	}, prefetchDelay);
}
