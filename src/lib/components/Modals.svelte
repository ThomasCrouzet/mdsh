<script lang="ts">
	// §P3.1 - Mounting component for the lazy-loaded modals.
	//
	// Receives the `modals` instance (createModals) and the callbacks needed
	// for each modal's props. The lazy-load is preserved: each modal
	// is fetched from the network only on first opening via `{#if open}{#await}`.
	//
	// BUNDLE CONSTRAINT: no static import of a modal here. All
	// components are mounted via `{#await modals.loadXxx() then Cmp}`.

	import type { EditMode } from '$lib/types';
	import type { createModals } from '$lib/ui/modals.svelte';
	import type { createEditorWidth } from '$lib/ui/editor-width.svelte';
	import type { createUiPrefs } from '$lib/ui/prefs.svelte';

	interface Props {
		modals: ReturnType<typeof createModals>;
		editorWidth: ReturnType<typeof createEditorWidth>;
		prefs: ReturnType<typeof createUiPrefs>;
		// File callbacks
		onNew: () => void;
		onImport: () => void;
		onExport: () => void;
		onExportHTML: () => void;
		onExportPDF: () => void;
		onExportAll: () => void;
		onToggleSidebar: () => void;
		onSetMode: (m: EditMode) => void;
		onOpenInFileSearch: () => void;
	}

	let {
		modals,
		editorWidth,
		prefs,
		onNew,
		onImport,
		onExport,
		onExportHTML,
		onExportPDF,
		onExportAll,
		onToggleSidebar,
		onSetMode,
		onOpenInFileSearch
	}: Props = $props();
</script>

<!-- §A1.1 - The modals load only on first opening. The pattern
     `{#if open}{#await loader() then Cmp}` guarantees that no byte is fetched
     until the user presses ⌘⇧P / ⌘⇧F / opens the disk or workspaces panel.
     The browser caches the ESM module -> instant 2nd opening.
     The component handles its own internal `{#if open}` for transitions. -->

{#if modals.paletteOpen}
	{#await modals.loadCommandPalette() then CommandPalette}
		<CommandPalette
			open={modals.paletteOpen}
			onClose={() => (modals.paletteOpen = false)}
			{onNew}
			{onImport}
			onExportMd={onExport}
			onExportHtml={onExportHTML}
			onExportPdf={onExportPDF}
			{onExportAll}
			{onToggleSidebar}
			{onSetMode}
			onOpenSearch={() => (modals.searchOpen = true)}
			{onOpenInFileSearch}
			onSetEditorWidth={editorWidth.setEditorWidth}
			onResetEditorWidth={editorWidth.resetEditorWidth}
			focusMode={prefs.focusMode}
			onToggleFocus={prefs.toggleFocusMode}
			typewriterMode={prefs.typewriterMode}
			onToggleTypewriter={prefs.toggleTypewriterMode}
			tocVisible={prefs.tocVisible}
			onToggleToc={prefs.toggleToc}
			onOpenDiskLinks={() => (modals.diskLinksOpen = true)}
			onOpenWorkspaces={() => (modals.workspacesOpen = true)}
			onOpenSettings={() => (modals.settingsOpen = true)}
			onOpenHistory={() => (modals.historyOpen = true)}
			onOpenGraph={() => (modals.graphOpen = true)}
			onOpenPresentation={() => (modals.presentationOpen = true)}
		/>
	{:catch}
		<!-- Load failure handled by the loader (toast + close). -->
	{/await}
{/if}

{#if modals.searchOpen}
	{#await modals.loadSearchPanel() then SearchPanel}
		<SearchPanel
			open={modals.searchOpen}
			onClose={() => (modals.searchOpen = false)}
			onOpenHit={modals.handleOpenHit}
		/>
	{:catch}
		<!-- Load failure handled by the loader (toast + close). -->
	{/await}
{/if}

{#if modals.diskLinksOpen}
	{#await modals.loadDiskLinksPanel() then DiskLinksPanel}
		<DiskLinksPanel open={modals.diskLinksOpen} onClose={() => (modals.diskLinksOpen = false)} />
	{:catch}
		<!-- Load failure handled by the loader (toast + close). -->
	{/await}
{/if}

{#if modals.workspacesOpen}
	{#await modals.loadWorkspacesPanel() then WorkspacesPanel}
		<WorkspacesPanel open={modals.workspacesOpen} onClose={() => (modals.workspacesOpen = false)} />
	{:catch}
		<!-- Load failure handled by the loader (toast + close). -->
	{/await}
{/if}

{#if modals.settingsOpen}
	{#await modals.loadSettingsPanel() then SettingsPanel}
		<SettingsPanel
			open={modals.settingsOpen}
			onClose={() => (modals.settingsOpen = false)}
			{editorWidth}
			{prefs}
		/>
	{:catch}
		<!-- Load failure handled by the loader (toast + close). -->
	{/await}
{/if}

{#if modals.historyOpen}
	{#await modals.loadHistoryPanel() then VersionHistoryPanel}
		<VersionHistoryPanel open={modals.historyOpen} onClose={() => (modals.historyOpen = false)} />
	{:catch}
		<!-- Load failure handled by the loader (toast + close). -->
	{/await}
{/if}

{#if modals.graphOpen}
	{#await modals.loadGraphPanel() then GraphPanel}
		<GraphPanel open={modals.graphOpen} onClose={() => (modals.graphOpen = false)} />
	{:catch}
		<!-- Load failure handled by the loader (toast + close). -->
	{/await}
{/if}

{#if modals.presentationOpen}
	{#await modals.loadPresentation() then PresentationView}
		<PresentationView
			open={modals.presentationOpen}
			onClose={() => (modals.presentationOpen = false)}
		/>
	{:catch}
		<!-- Load failure handled by the loader (toast + close). -->
	{/await}
{/if}
