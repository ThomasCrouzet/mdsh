<script lang="ts">
	// Read view: full HTML rendering via our renderer (same output as the PDF).
	// Supports: GFM, KaTeX, highlight.js, Mermaid diagrams.
	//
	// The renderer is dynamically imported - loads only when the user
	// enters read mode (or triggers a PDF/HTML export elsewhere).

	import '../render/preview.css';
	import { filesStore } from '$lib/files.svelte';
	import { decodeWikiTarget } from '$lib/wiki-links';
	import { t } from '$lib/i18n';
	import { mermaidThemeFromDataTheme } from '$lib/theme';
	import { themeStore } from '$lib/ui/theme.svelte';

	interface Props {
		fileId: string;
		content: string;
		/** Callback invoked when the rendered `<article>` is mounted/unmounted.
		 *  Lets a consumer (e.g. TOC) target this container without
		 *  digging through the DOM itself. */
		onArticleRef?: (el: HTMLElement | null) => void;
	}

	let { fileId, content, onArticleRef }: Props = $props();
	let articleEl: HTMLElement | null = $state(null);

	/**
	 * §5.2 - Intercepts clicks on `.wiki-link`:
	 *   - Reads the target from `data-mdsh-wiki`
	 *   - Blocks following the href (which is a logical anchor with no DOM target)
	 *   - Delegates to the store: navigate to the existing file, or create
	 *     a new file (Obsidian behavior) if not found
	 *
	 * Delegation at the article level: a single listener for all rendered
	 * wiki-links, robust to re-renders (DOM regenerated on every content
	 * change).
	 */
	/**
	 * Shared click/keyboard logic: walks up to the `a.wiki-link` parent of the
	 * event target, reads the encoded target, blocks following the href
	 * (internal anchor with no real DOM target) and delegates to the store.
	 * Returns `true` if a wiki-link was opened (so the caller knows whether
	 * it should consume the event).
	 */
	function openWikiLinkFromEvent(e: Event): boolean {
		const target = e.target as HTMLElement | null;
		const link = target?.closest<HTMLAnchorElement>('a.wiki-link');
		if (!link) return false;
		const encoded = link.getAttribute('data-mdsh-wiki');
		if (!encoded) return false;
		const wikiTarget = decodeWikiTarget(encoded);
		// Always preventDefault: the href is an internal anchor (no real DOM
		// target), following the link would just add a useless history entry.
		// cmd/ctrl-click has no useful behavior on an internal mdsh link - we
		// block it uniformly.
		e.preventDefault();
		filesStore.openWikiLink(wikiTarget);
		return true;
	}

	function handleWikiLinkClick(e: MouseEvent) {
		openWikiLinkFromEvent(e);
	}

	/**
	 * §a11y (WCAG 2.1.1) - keyboard activation of wiki-links in read mode.
	 * Without this, Tab + Enter followed the dummy `#mdsh-wiki-…` anchor instead
	 * of opening the target file. We handle Enter and Space, taking exactly
	 * the same path as the click. The guard on `a.wiki-link` avoids any
	 * interference with normal typing elsewhere in the article.
	 */
	function handleWikiLinkKeydown(e: KeyboardEvent) {
		if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
		openWikiLinkFromEvent(e);
	}

	// Notifies the parent on every reference change (mount, unmount,
	// switch between error state and article).
	$effect(() => {
		onArticleRef?.(articleEl);
	});

	let html = $state('');
	// §B3.1 - `loading` is now gated by a 200 ms timer. Before: a "Rendering…"
	// flash on every switch (~50 ms typical). The pattern mirrors
	// `spinner.svelte.ts`: we only show the spinner if the render takes > 200 ms,
	// enough to avoid disrupting a fast workflow.
	let loading = $state(false);
	let err = $state<string | null>(null);
	let renderSeq = 0;

	async function doRender(md: string, fid: string) {
		const seq = ++renderSeq;
		err = null;
		const loadingTimer = setTimeout(() => {
			if (seq === renderSeq) loading = true;
		}, 200);
		try {
			const { renderMarkdown } = await import('../render/markdown');
			// Mermaid palette follows the live UI theme (same rule as presentation mode).
			const mermaidTheme = mermaidThemeFromDataTheme(
				document.documentElement.getAttribute('data-theme')
			);
			const out = await renderMarkdown(md, { mermaidTheme, headingPermalinks: true });
			if (seq !== renderSeq) return; // a more recent render has started
			if (fid !== fileId) return; // the file changed in the meantime
			html = out;
		} catch (e) {
			if (seq !== renderSeq) return;
			err = e instanceof Error ? e.message : String(e);
		} finally {
			clearTimeout(loadingTimer);
			if (seq === renderSeq) loading = false;
		}
	}

	// Re-render when content, file, or UI theme changes (Mermaid palette).
	$effect(() => {
		const c = content;
		const f = fileId;
		// Subscribe to theme pref so light/dark toggles re-run Mermaid.
		void themeStore.pref;
		void doRender(c, f);
	});
</script>

<div class="mdsh-read-wrapper">
	<div class="mdsh-read">
		{#if err}
			<div class="mdsh-read-error" role="alert">
				<strong>{t('read.renderError')}</strong>
				<pre>{err}</pre>
			</div>
		{:else}
			<!-- Delegated onclick + onkeydown: capture the activation of child
			     `.wiki-link` elements - the article itself is not interactive,
			     it is the internal <a> elements (keyboard-focusable) that are. The
			     delegation to the parent avoids N listeners on links regenerated on
			     every render. The keydown makes wiki-links activable with the
			     keyboard (Enter/Space) - otherwise Tab+Enter followed the dummy
			     anchor instead of opening the target file (WCAG 2.1.1). -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<article
				class="mdsh-preview"
				bind:this={articleEl}
				aria-busy={loading}
				onclick={handleWikiLinkClick}
				onkeydown={handleWikiLinkKeydown}
			>
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				{@html html}
			</article>
		{/if}
	</div>
	{#if loading && !err}
		<div class="mdsh-read-loading" role="status" aria-live="polite">{t('read.rendering')}</div>
	{/if}
</div>

<style>
	.mdsh-read-wrapper {
		position: relative;
		height: 100%;
		width: 100%;
	}
	.mdsh-read {
		height: 100%;
		width: 100%;
		overflow-y: auto;
	}
	.mdsh-read-loading {
		position: absolute;
		top: 0.6rem;
		right: 0.9rem;
		padding: 0.2rem 0.6rem;
		font-size: 11px;
		color: var(--color-fg-dim);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xs);
		opacity: 0.85;
		pointer-events: none;
	}
	.mdsh-read-error {
		max-width: 720px;
		margin: 2rem auto;
		padding: 1rem 1.2rem;
		color: #ff9b9b;
		background: rgba(255, 80, 80, 0.08);
		border: 1px solid rgba(255, 80, 80, 0.25);
		border-radius: var(--radius-md);
		font-family: var(--font-mono);
		font-size: 13px;
	}
	.mdsh-read-error pre {
		margin: 0.6em 0 0;
		white-space: pre-wrap;
	}
</style>
