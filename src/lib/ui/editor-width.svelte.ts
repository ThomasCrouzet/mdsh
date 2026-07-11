// §P2.1 - Module managing the editor width.
//
// Exposes a `createEditorWidth()` factory to call top-level in the parent
// component's `<script>` (Svelte 5 constraint: `$effect`s must be
// created within the component's init scope).
//
// Logic extracted from `+page.svelte` (L180-242 + L415-435).

import { browser } from '$app/environment';
import { EDITOR } from '$lib/config';

const DEFAULT_EDITOR_WIDTH = EDITOR.defaultWidth;
const MIN_EDITOR_WIDTH = EDITOR.minWidth;
const EDITOR_WIDTH_MARGIN = EDITOR.margin;

export function createEditorWidth(opts: {
	getHydrated: () => boolean;
	getResizing: () => boolean;
}) {
	// Internal reactive state
	let editorMaxWidth = $state<number>(DEFAULT_EDITOR_WIDTH);
	let resizing = $state(false);

	// Non-reactive drag variables (updated on each pointermove)
	let resizeHandle: HTMLDivElement | null = null;
	let resizeStartX = 0;
	let resizeStartWidth = 0;
	// rAF-throttle of the drag: on a 120 Hz macOS trackpad (and some
	// high-polling mice), pointermove can fire > 60 times/s. Each update of
	// editorMaxWidth forces a full ProseMirror reflow (word wrap). We
	// coalesce to 1 update per paint frame.
	let resizeRafId = 0;
	let resizePendingX = 0;

	function clampEditorWidth(w: number): number {
		if (!browser) return w;
		const maxAllowed = Math.max(MIN_EDITOR_WIDTH, window.innerWidth - EDITOR_WIDTH_MARGIN);
		return Math.round(Math.max(MIN_EDITOR_WIDTH, Math.min(maxAllowed, w)));
	}

	function persistEditorWidth(w: number) {
		if (!browser) return;
		localStorage.setItem('mdsh:editor-width', String(w));
	}

	function startResize(e: PointerEvent) {
		if (!resizeHandle) return;
		resizing = true;
		resizeStartX = e.clientX;
		resizeStartWidth = editorMaxWidth;
		resizeHandle.setPointerCapture(e.pointerId);
		e.preventDefault();
	}

	function onResize(e: PointerEvent) {
		if (!resizing) return;
		resizePendingX = e.clientX;
		if (resizeRafId) return;
		resizeRafId = requestAnimationFrame(() => {
			resizeRafId = 0;
			if (!resizing) return;
			const deltaX = resizePendingX - resizeStartX;
			editorMaxWidth = clampEditorWidth(resizeStartWidth + deltaX * 2);
		});
	}

	function stopResize(e: PointerEvent) {
		if (!resizing) return;
		resizing = false;
		if (resizeRafId) {
			cancelAnimationFrame(resizeRafId);
			resizeRafId = 0;
		}
		if (resizeHandle && resizeHandle.hasPointerCapture(e.pointerId)) {
			resizeHandle.releasePointerCapture(e.pointerId);
		}
		persistEditorWidth(editorMaxWidth);
	}

	function resetEditorWidth() {
		editorMaxWidth = clampEditorWidth(DEFAULT_EDITOR_WIDTH);
		persistEditorWidth(editorMaxWidth);
	}

	function setEditorWidth(w: number) {
		editorMaxWidth = clampEditorWidth(w);
		persistEditorWidth(editorMaxWidth);
	}

	// §A2.5 - Re-clamp the editor width if the window shrinks below the current value.
	// Skip during an active drag so we do not overwrite the value the user is manipulating.
	// rAF-throttle: `resize` can fire >10 times/s during a desktop window
	// drag or a mobile orientation change. We coalesce to 1 per paint.
	// This $effect MUST be called top-level in the parent component.
	$effect(() => {
		if (!browser || !opts.getHydrated()) return;
		let raf = 0;
		const onWindowResize = () => {
			if (opts.getResizing() || raf) return;
			raf = requestAnimationFrame(() => {
				raf = 0;
				if (opts.getResizing()) return;
				editorMaxWidth = clampEditorWidth(editorMaxWidth);
			});
		};
		window.addEventListener('resize', onWindowResize);
		return () => {
			window.removeEventListener('resize', onWindowResize);
			if (raf) cancelAnimationFrame(raf);
		};
	});

	// Load the persisted width from localStorage (to call in onMount).
	function loadPersistedWidth() {
		if (!browser) return;
		const savedWidth = localStorage.getItem('mdsh:editor-width');
		if (savedWidth) {
			const n = Number(savedWidth);
			if (Number.isFinite(n) && n >= MIN_EDITOR_WIDTH) {
				editorMaxWidth = clampEditorWidth(n);
			}
		}
	}

	return {
		get editorMaxWidth() {
			return editorMaxWidth;
		},
		get resizing() {
			return resizing;
		},
		setResizeHandle(el: HTMLDivElement | null) {
			resizeHandle = el;
		},
		clampEditorWidth,
		loadPersistedWidth,
		startResize,
		onResize,
		stopResize,
		resetEditorWidth,
		setEditorWidth
	};
}
