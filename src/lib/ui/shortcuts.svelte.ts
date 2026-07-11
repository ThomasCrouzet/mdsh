// §P2.2 - Module managing the global keyboard shortcuts.
//
// Pure logic with no $effect - no factory needed.
// The parent component passes the callbacks and attaches the listener via
// `<svelte:window onkeydown={handleKeydown}>`.
//
// Logic extracted from `+page.svelte` (L630-695).

import { isFSASupported } from '$lib/fsa';
import type { EditMode } from '$lib/types';

export interface ShortcutCallbacks {
	// Files
	onNew: () => void;
	onImport: () => Promise<void> | void;
	onExport: () => void;
	onExportPDF: () => void;
	onSaveToDisk: () => Promise<void> | void;
	// Navigation / modes
	getMode: () => EditMode;
	setMode: (m: EditMode) => void;
	// UI
	onToggleSidebar: () => void;
	onOpenPalette: () => void;
	onOpenSearch: () => void;
	onOpenInFileSearch: () => void;
	onOpenSettings: () => void;
	onToggleFocus: () => void;
	// Current file
	getActiveId: () => string | null;
	onClose: (id: string) => void;
}

/**
 * Builds the global `keydown` handler from the injected callbacks.
 * Covers all the application's ⌘ shortcuts.
 *
 * Usage: call this function in the parent component's `<script>`, then
 * wire the result onto `<svelte:window onkeydown={handleKeydown}>`.
 */
export function buildKeydownHandler(cb: ShortcutCallbacks) {
	return function handleKeydown(e: KeyboardEvent) {
		const target = e.target as HTMLElement | null;
		const mod = e.metaKey || e.ctrlKey;
		if (!mod) return;

		const key = e.key.toLowerCase();
		const mode = cb.getMode();
		const activeId = cb.getActiveId();

		if (key === 'n' && !e.shiftKey) {
			e.preventDefault();
			cb.onNew();
		} else if (key === 'o' && !e.shiftKey) {
			e.preventDefault();
			void cb.onImport();
		} else if (key === 's' && e.shiftKey) {
			if (isFSASupported()) {
				e.preventDefault();
				void cb.onSaveToDisk();
			}
		} else if (key === 's' && !e.shiftKey) {
			e.preventDefault();
			cb.onExport();
		} else if (key === 'p' && !e.shiftKey && activeId) {
			// ⌘P: intercepted only if a file is active. Without a file, we let
			// the browser's native print fire (consistent with user expectation).
			e.preventDefault();
			cb.onExportPDF();
		} else if (key === 'b' && !e.shiftKey) {
			e.preventDefault();
			cb.onToggleSidebar();
		} else if (key === 'e' && !e.shiftKey) {
			e.preventDefault();
			cb.setMode('wysiwyg');
		} else if (key === 'r' && !e.shiftKey) {
			e.preventDefault();
			cb.setMode('read');
		} else if (key === '/') {
			e.preventDefault();
			cb.setMode(mode === 'source' ? 'wysiwyg' : 'source');
		} else if (key === 'p' && e.shiftKey) {
			e.preventDefault();
			cb.onOpenPalette();
		} else if (key === ',') {
			// ⌘,: settings (macOS "Preferences" convention).
			e.preventDefault();
			cb.onOpenSettings();
		} else if (key === 'f' && e.shiftKey) {
			e.preventDefault();
			cb.onOpenSearch();
		} else if (key === 'f' && !e.shiftKey && activeId) {
			// `⌘F`: search within the active file. We intercept the browser's
			// native find - it makes no sense in WYSIWYG mode (ProseMirror), and
			// in source mode CodeMirror handles it better than the native find
			// (highlight, navigation, replace).
			e.preventDefault();
			cb.onOpenInFileSearch();
		} else if ((key === '.' || e.code === 'Period') && e.shiftKey) {
			// ⌘⇧.: toggle focus mode. We accept key === '.' (layouts where Shift+.
			// yields '.') AND code === 'Period' (physical US layout, useful for
			// layouts where the key produces a different logical character).
			e.preventDefault();
			cb.onToggleFocus();
		} else if (key === 'w' && activeId && !e.shiftKey) {
			const editable =
				target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
			if (!editable) {
				e.preventDefault();
				cb.onClose(activeId);
			}
		}
	};
}
