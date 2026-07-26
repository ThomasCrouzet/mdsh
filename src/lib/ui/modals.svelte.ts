// §P3.1 - Module managing the lazy-loaded modals.
//
// Groups together:
//   - The open state of each modal (paletteOpen, searchOpen, etc.)
//   - The memoized loaders (dynamic import(), never static)
//   - The `handleOpenHit` handler (SearchPanel → SourceEditor)
//   - The Toc loader (used in EditorPane)
//
// Exposes a `createModals()` factory to call top-level in the parent
// component's `<script>` (Svelte 5 constraint: `$effect`s must be
// created within the component's init scope).
//
// BUNDLE CONSTRAINT: no static import of any modal / rendering lib here.
// All component imports go through memoized dynamic import()s.

import type { EditMode } from '$lib/types';
import { reportError } from '$lib/report';
import { t, type MessageKey } from '$lib/i18n';

/**
 * Builds a memoized loader for a lazy modal. If the `import()` fails
 * (chunk unavailable offline, stale PWA cache after a deployment), we
 * RESET the memo (retry possible), close the modal (`close`) and notify
 * the user - instead of a modal that silently never appears. The re-throw
 * lets the template's `{:catch}` avoid trying to mount an undefined
 * component.
 *
 * The component's typing is inferred from the `import()` - so we keep the
 * lazy-load with no static import (bundle constraint).
 */
/** Exported for unit tests (failure path: close + report + rethrow). */
export function makeLazyLoader<T>(
	importer: () => Promise<{ default: T }>,
	close: () => void,
	labelKey: MessageKey
): () => Promise<T> {
	let promise: Promise<T> | null = null;
	return () => {
		promise ??= importer()
			.then((m) => m.default)
			.catch((err) => {
				promise = null;
				close();
				const label = t(labelKey);
				reportError(`lazy load (${label})`, err, {
					notifyUser: t('modals.loadFailed', { label })
				});
				throw err;
			});
		return promise;
	};
}

// Structural interface for SourceEditor (avoids the static import of the component).
interface SourceEditorRef {
	openSearch?: () => void;
	goToLine?: (line: number, query: string) => void;
}

export interface ModalsOptions {
	getMode: () => EditMode;
	setMode: (m: EditMode) => void;
	getFilesStoreActive: () => { id: string } | null;
	getFilesStoreSetActive: () => (id: string) => void;
	getSourceEditorRef: () => SourceEditorRef | null;
	// Callback to post a contextual accessibility announcement
	announceContext: (msg: string) => void;
	// Setters for the pendingGoToHit and pendingOpenSearch states
	setPendingGoToHit: (v: { line: number; query: string } | null) => void;
	setPendingOpenSearch: (v: boolean) => void;
}

export function createModals(opts: ModalsOptions) {
	// §A1.1 - Open states of the modals
	let paletteOpen = $state(false);
	let searchOpen = $state(false);
	let diskLinksOpen = $state(false);
	let workspacesOpen = $state(false);
	let settingsOpen = $state(false);
	let historyOpen = $state(false);
	let graphOpen = $state(false);
	let presentationOpen = $state(false);

	// §A1.1 / A1.2 - Memoized loaders: one loading function per modal.
	// The browser caches the ESM module by URL → instant 2nd open. The memo
	// (internal to `makeLazyLoader`) is reset on an import failure to allow
	// a retry, and closes + notifies instead of failing silently.
	const loadCommandPalette = makeLazyLoader(
		() => import('$lib/components/CommandPalette.svelte'),
		() => {
			paletteOpen = false;
		},
		'modals.labelPalette'
	);
	const loadSearchPanel = makeLazyLoader(
		() => import('$lib/components/SearchPanel.svelte'),
		() => {
			searchOpen = false;
		},
		'modals.labelSearch'
	);
	const loadDiskLinksPanel = makeLazyLoader(
		() => import('$lib/components/DiskLinksPanel.svelte'),
		() => {
			diskLinksOpen = false;
		},
		'modals.labelDiskLinks'
	);
	const loadWorkspacesPanel = makeLazyLoader(
		() => import('$lib/components/WorkspacesPanel.svelte'),
		() => {
			workspacesOpen = false;
		},
		'modals.labelWorkspaces'
	);
	const loadSettingsPanel = makeLazyLoader(
		() => import('$lib/components/SettingsPanel.svelte'),
		() => {
			settingsOpen = false;
		},
		'modals.labelSettings'
	);
	const loadHistoryPanel = makeLazyLoader(
		() => import('$lib/components/VersionHistoryPanel.svelte'),
		() => {
			historyOpen = false;
		},
		'modals.labelHistory'
	);
	const loadGraphPanel = makeLazyLoader(
		() => import('$lib/components/GraphPanel.svelte'),
		() => {
			graphOpen = false;
		},
		'modals.labelGraph'
	);
	const loadPresentation = makeLazyLoader(
		() => import('$lib/components/PresentationView.svelte'),
		() => {
			presentationOpen = false;
		},
		'modals.labelPresentation'
	);
	// The TOC has no open state of its own (mounted in EditorPane): close is a no-op.
	const loadToc = makeLazyLoader(
		() => import('$lib/components/Toc.svelte'),
		() => {},
		'modals.labelToc'
	);

	// Open actions
	function openPalette() {
		paletteOpen = true;
	}

	function openSearch() {
		searchOpen = true;
	}

	function openDiskLinks() {
		diskLinksOpen = true;
	}

	function openWorkspaces() {
		workspacesOpen = true;
	}

	function openSettings() {
		settingsOpen = true;
	}

	function openHistory() {
		historyOpen = true;
	}

	function openGraph() {
		graphOpen = true;
	}

	function openPresentation() {
		presentationOpen = true;
	}

	// §B3.7 - Handler invoked by SearchPanel when a hit is clicked: switches
	// to the target file in source mode, scrolls to the line and preloads
	// the query into the CodeMirror panel. If the SourceEditor is not yet
	// mounted, its own `goToLine` method buffers the request.
	function handleOpenHit(fileId: string, line: number, query: string) {
		opts.getFilesStoreSetActive()(fileId);
		if (opts.getMode() !== 'source') {
			opts.setPendingGoToHit({ line, query });
			opts.setMode('source');
		} else {
			opts.getSourceEditorRef()?.goToLine?.(line, query);
		}
	}

	return {
		// Open states (read/write via getters)
		get paletteOpen() {
			return paletteOpen;
		},
		set paletteOpen(v: boolean) {
			paletteOpen = v;
		},
		get searchOpen() {
			return searchOpen;
		},
		set searchOpen(v: boolean) {
			searchOpen = v;
		},
		get diskLinksOpen() {
			return diskLinksOpen;
		},
		set diskLinksOpen(v: boolean) {
			diskLinksOpen = v;
		},
		get workspacesOpen() {
			return workspacesOpen;
		},
		set workspacesOpen(v: boolean) {
			workspacesOpen = v;
		},
		get settingsOpen() {
			return settingsOpen;
		},
		set settingsOpen(v: boolean) {
			settingsOpen = v;
		},
		get historyOpen() {
			return historyOpen;
		},
		set historyOpen(v: boolean) {
			historyOpen = v;
		},
		get graphOpen() {
			return graphOpen;
		},
		set graphOpen(v: boolean) {
			graphOpen = v;
		},
		get presentationOpen() {
			return presentationOpen;
		},
		set presentationOpen(v: boolean) {
			presentationOpen = v;
		},
		// Loaders
		loadCommandPalette,
		loadSearchPanel,
		loadDiskLinksPanel,
		loadWorkspacesPanel,
		loadSettingsPanel,
		loadHistoryPanel,
		loadGraphPanel,
		loadPresentation,
		loadToc,
		// Actions
		openPalette,
		openSearch,
		openDiskLinks,
		openWorkspaces,
		openSettings,
		openHistory,
		openGraph,
		openPresentation,
		handleOpenHit
	};
}
