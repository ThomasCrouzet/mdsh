<script lang="ts">
	// §P3.2 - Main editing pane: 3-mode switch + resize handle + drag overlay + TOC.
	//
	// Receives as props the active file's data, the current mode, the editorWidth
	// and modals instances (for the lazy-load TOC), and the callbacks to surface
	// the refs (sourceEditorRef, articleRef) and events up to the page.
	//
	// The resize handle is managed here: `bind:this={resizeHandleEl}` + a local
	// `$effect` that syncs to editorWidth.setResizeHandle. This avoids leaving in
	// +page.svelte an `$effect` whose only purpose is a bind:this of an element
	// belonging to this component.
	//
	// BUNDLE CONSTRAINT: no static import of SourceEditor / Editor / ReadView
	// here - they are already imported in +page.svelte (they are entry chunks).
	// The TOC stays lazy-loaded via modals.loadToc().

	import Editor from '$lib/components/Editor.svelte';
	import SourceEditor from '$lib/components/SourceEditor.svelte';
	import ReadView from '$lib/components/ReadView.svelte';
	import Welcome from '$lib/components/Welcome.svelte';
	import { Upload } from 'lucide-svelte';
	import type { EditMode, FileItem } from '$lib/types';
	import type { createEditorWidth } from '$lib/ui/editor-width.svelte';
	import type { createModals } from '$lib/ui/modals.svelte';
	import { t } from '$lib/i18n';

	interface Props {
		activeFile: FileItem | null;
		mode: EditMode;
		editorWidth: ReturnType<typeof createEditorWidth>;
		modals: ReturnType<typeof createModals>;
		dragOver: boolean;
		tocEmpty: boolean;
		tocVisible: boolean;
		focusMode: boolean;
		/** Reference to the `<article>` rendered by ReadView, for the TOC scrollspy. */
		articleRef: HTMLElement | null;
		// Callbacks to surface the refs up to +page.svelte
		onSourceEditorRef: (ref: SourceEditor | null) => void;
		onArticleRef: (el: HTMLElement | null) => void;
		onTocEmpty: (empty: boolean) => void;
		// Action callbacks
		onEditorChange: (markdown: string) => void;
		// §C1 - Flush of the last WYSIWYG keystroke to a specific file
		// (the old tab) before the editor remounts.
		onEditorFlush: (fileId: string, markdown: string) => void;
		onNew: () => void;
		onImport: () => void;
		onDemo: () => void;
	}

	let {
		activeFile,
		mode,
		editorWidth,
		modals,
		dragOver,
		tocEmpty,
		tocVisible,
		focusMode,
		articleRef,
		onSourceEditorRef,
		onArticleRef,
		onTocEmpty,
		onEditorChange,
		onEditorFlush,
		onNew,
		onImport,
		onDemo
	}: Props = $props();

	// Local reference to the resize handle. bind:this only accepts
	// identifiers - we go through a local variable + $effect.
	let resizeHandleEl = $state<HTMLDivElement | null>(null);
	$effect(() => {
		editorWidth.setResizeHandle(resizeHandleEl);
	});

	// Local reference to the SourceEditor. bind:this does not accept a lambda
	// (error "bind_invalid_expression") - local variable + $effect to
	// surface the ref up to +page.svelte via onSourceEditorRef.
	let sourceEditorEl = $state<SourceEditor | null>(null);
	$effect(() => {
		onSourceEditorRef(sourceEditorEl);
	});
</script>

<div class="mdsh-content-col relative flex min-h-0 min-w-0 flex-1 flex-col">
	{#if activeFile}
		{#if mode === 'source'}
			<SourceEditor
				bind:this={sourceEditorEl}
				content={activeFile.content}
				onChange={onEditorChange}
			/>
		{:else if mode === 'read'}
			<ReadView fileId={activeFile.id} content={activeFile.content} {onArticleRef} />
		{:else}
			<Editor
				fileId={activeFile.id}
				content={activeFile.content}
				onChange={onEditorChange}
				onFlush={onEditorFlush}
			/>
		{/if}

		<!-- Resize handle (desktop only); role presentation because
		     mouse dragging is a convenience, keyboard presets go through the palette (⌘⇧P). -->
		<div
			bind:this={resizeHandleEl}
			class="resize-handle"
			class:resizing={editorWidth.resizing}
			onpointerdown={editorWidth.startResize}
			onpointermove={editorWidth.onResize}
			onpointerup={editorWidth.stopResize}
			onpointercancel={editorWidth.stopResize}
			ondblclick={editorWidth.resetEditorWidth}
			role="presentation"
			aria-hidden="true"
			title={t('editorPane.resizeHandle', { width: editorWidth.editorMaxWidth })}
		></div>
	{:else}
		<Welcome {onNew} {onImport} {onDemo} />
	{/if}

	{#if dragOver}
		<div
			class="pointer-events-none absolute inset-3 z-20 flex items-center justify-center
			       rounded-lg border-2 border-dashed border-accent bg-bg/80 backdrop-blur-sm"
		>
			<div class="flex flex-col items-center gap-2 text-accent">
				<Upload size={32} />
				<p class="text-sm font-medium">{t('editorPane.dropFiles')}</p>
			</div>
		</div>
	{/if}
</div>

<!-- TOC column: mounted only in read mode + enabled + non-empty
     + outside focus mode. The component reports emptiness via `onTocEmpty`;
     we then remove the column (otherwise the 220 px stay reserved).
     Lazy-loaded (cf. modals.loadToc) - chunk separate from the page chunk. -->
{#if mode === 'read' && tocVisible && activeFile && !focusMode && !tocEmpty}
	<aside class="mdsh-toc-col">
		{#await modals.loadToc() then Toc}
			<Toc target={articleRef} onEmpty={onTocEmpty} />
		{/await}
	</aside>
{:else if mode === 'read' && tocVisible && activeFile && !focusMode}
	<!-- Toc mounted off-screen while it discovers the 1st heading.
	     Without this, `tocEmpty` stays true initially and the column
	     never reappears. -->
	<div class="sr-only">
		{#await modals.loadToc() then Toc}
			<Toc target={articleRef} onEmpty={onTocEmpty} />
		{/await}
	</div>
{/if}

<style>
	/* Editor resize handle - positioned on the right edge of the centered
	   area, clamped to the window edge if the width overflows. */
	.resize-handle {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 14px;
		left: min(calc(50% + var(--editor-max-width, 820px) / 2 - 7px), calc(100% - 14px));
		cursor: col-resize;
		touch-action: none;
		z-index: 10;
		background: transparent;
		transition: background 0.15s ease;
	}
	.resize-handle::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		width: 3px;
		height: 56px;
		background: var(--color-border-strong);
		transform: translate(-50%, -50%);
		opacity: 0.55;
		transition:
			opacity 0.18s ease,
			background 0.18s ease,
			width 0.15s ease,
			height 0.15s ease;
		border-radius: 2px;
	}
	.resize-handle:hover::after {
		opacity: 1;
		background: var(--color-accent);
		height: 72px;
	}
	.resize-handle.resizing::after,
	.resize-handle:active::after {
		opacity: 1;
		background: var(--color-accent);
		width: 4px;
		height: 88px;
	}
	/* Hide on mobile: no fine pointer, not really useful */
	@media (max-width: 767px), (pointer: coarse) {
		.resize-handle {
			display: none;
		}
	}

	/* ============================================================================
	   Table of contents - fixed right column in read mode (desktop >= 1024 px).
	   On mobile the column collapses: the inner TOC is hidden by its own
	   media query, but we also avoid reserving the width here so all the
	   space goes to the text.
	   ============================================================================ */
	.mdsh-toc-col {
		flex: 0 0 220px;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}
	@media (max-width: 1023px) {
		.mdsh-toc-col {
			display: none;
		}
	}
</style>
