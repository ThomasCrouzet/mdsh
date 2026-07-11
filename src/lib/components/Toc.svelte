<script lang="ts">
	// Floating table of contents - extracts h1/h2/h3 from the rendered DOM and
	// highlights the active section via IntersectionObserver. Smooth-scroll
	// on click. Rebuilt when the `target` changes (mode switch) or when
	// its content mutates (read re-render after an edit).
	//
	// v1 limitation: active only in read mode. WYSIWYG mode
	// (Milkdown / ProseMirror) constantly rewrites the DOM during editing,
	// which would make the TOC noisy and costly - deferred to a v2.
	import { onDestroy } from 'svelte';
	// §B5.2 - Reuses the slugify shared with render/markdown.ts to
	// guarantee that the ids generated here match those of the wiki-links /
	// internal anchors. Before: a similar regex was duplicated (potential drift).
	import { slugify } from '$lib/wiki-links';
	import { t } from '$lib/i18n';

	interface TocItem {
		id: string;
		text: string;
		level: 1 | 2 | 3;
	}

	interface Props {
		/** Container in which to look for headings (article preview or .ProseMirror). */
		target: HTMLElement | null;
		/** Notifies the parent that the TOC is empty (nothing to show). */
		onEmpty?: (empty: boolean) => void;
	}

	let { target, onEmpty }: Props = $props();

	let items = $state<TocItem[]>([]);
	let activeId = $state<string | null>(null);
	let observer: IntersectionObserver | null = null;
	let mut: MutationObserver | null = null;
	// Debounce of the rebuilds: MutationObserver fires on every keystroke
	// when the read rendering is regenerated; we coalesce over 120 ms to
	// avoid thrashing the DOM (re-querySelectorAll + re-observe on every tick).
	let rebuildTimer: ReturnType<typeof setTimeout> | null = null;

	function buildToc() {
		if (!target) {
			if (items.length !== 0) items = [];
			activeId = null;
			onEmpty?.(true);
			return;
		}
		const headings = Array.from(target.querySelectorAll<HTMLElement>('h1, h2, h3'));
		// Local non-reactive Set (used only to deduplicate the ids
		// during the slugification pass) - no need for a SvelteSet here.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const used = new Set<string>();
		const next: TocItem[] = headings.map((h) => {
			// `slugify` (imported from $lib/wiki-links, §B5.2) may return '' if the
			// heading is purely non-ASCII: we keep a 'section' fallback to
			// preserve the original id ('section', 'section-2', …).
			const base = slugify(h.textContent ?? '').slice(0, 60) || 'section';
			let id = h.id;
			if (!id) {
				id = base;
				let suffix = 2;
				while (used.has(id)) {
					id = `${base}-${suffix++}`;
				}
				h.id = id;
			}
			used.add(id);
			return {
				id,
				text: h.textContent ?? '',
				// charAt(1) is preferred over [1]: returns '' if out of bounds (short tagName)
				// rather than undefined, which lets parseInt fall through to NaN -> || 1.
				level: (parseInt(h.tagName.charAt(1), 10) || 1) as 1 | 2 | 3
			};
		});
		items = next;
		onEmpty?.(next.length === 0);
		setupObserver(headings);
	}

	function setupObserver(headings: HTMLElement[]) {
		observer?.disconnect();
		observer = null;
		if (headings.length === 0) {
			activeId = null;
			return;
		}
		// Negative rootMargin at the bottom: "active" = the section whose
		// title is in the top 30 % of the viewport. Standard MDN scroll-spy
		// pattern, prevents the last visible title from stealing the active
		// state at the end of a long document.
		observer = new IntersectionObserver(
			(entries) => {
				const visible = entries.filter((e) => e.isIntersecting);
				if (visible.length > 0) {
					visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
					// invariant: visible.length > 0 guarantees visible[0] is defined.
					activeId = (visible[0]!.target as HTMLElement).id;
				}
			},
			{ rootMargin: '0px 0px -70% 0px', threshold: 0 }
		);
		headings.forEach((h) => observer!.observe(h));
	}

	function scheduleRebuild() {
		if (rebuildTimer) clearTimeout(rebuildTimer);
		rebuildTimer = setTimeout(() => {
			rebuildTimer = null;
			buildToc();
		}, 120);
	}

	$effect(() => {
		const t = target;
		// Immediate rebuild on mount / target change.
		buildToc();
		mut?.disconnect();
		mut = null;
		if (t) {
			mut = new MutationObserver(() => scheduleRebuild());
			mut.observe(t, { childList: true, subtree: true, characterData: true });
		}
		return () => {
			mut?.disconnect();
			mut = null;
			if (rebuildTimer) {
				clearTimeout(rebuildTimer);
				rebuildTimer = null;
			}
		};
	});

	onDestroy(() => {
		observer?.disconnect();
		mut?.disconnect();
		if (rebuildTimer) clearTimeout(rebuildTimer);
	});

	function jump(id: string) {
		const el = target?.querySelector<HTMLElement>('#' + CSS.escape(id));
		el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
</script>

{#if items.length > 0}
	<nav class="mdsh-toc" aria-label={t('toc.ariaLabel')}>
		<div class="mdsh-toc-title" aria-hidden="true">{t('toc.title')}</div>
		<ol>
			{#each items as item (item.id)}
				<li class="lvl-{item.level}" class:active={item.id === activeId}>
					<button
						type="button"
						onclick={() => jump(item.id)}
						title={item.text}
						aria-current={item.id === activeId ? 'location' : undefined}
					>
						{item.text}
					</button>
				</li>
			{/each}
		</ol>
	</nav>
{/if}

<style>
	.mdsh-toc {
		position: sticky;
		top: 1rem;
		max-height: calc(100dvh - 2rem);
		overflow-y: auto;
		padding: 0.75rem 0.75rem 1rem;
		font-size: 12px;
		line-height: 1.5;
		color: var(--color-fg-dim);
		border-left: 1px solid var(--color-border);
	}
	.mdsh-toc-title {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-fg-subtle);
		margin: 0 0 0.5rem 8px;
	}
	.mdsh-toc ol {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.mdsh-toc li {
		margin: 0;
	}
	.mdsh-toc li button {
		display: block;
		width: 100%;
		text-align: left;
		background: transparent;
		border: none;
		padding: 2px 0 2px 8px;
		color: inherit;
		cursor: pointer;
		border-left: 2px solid transparent;
		transition:
			color 0.12s,
			border-color 0.12s;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font: inherit;
	}
	.mdsh-toc li.lvl-2 button {
		padding-left: 18px;
	}
	.mdsh-toc li.lvl-3 button {
		padding-left: 28px;
		font-size: 11px;
	}
	.mdsh-toc li button:hover {
		color: var(--color-fg);
	}
	.mdsh-toc li button:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: -2px;
		border-radius: var(--radius-xs);
	}
	.mdsh-toc li.active button {
		color: var(--color-accent);
		border-left-color: var(--color-accent);
	}

	/* Mobile: the TOC is hidden. The toggle stays functional but the
	   grid column disappears on the +page.svelte side (cf. .with-toc). */
	@media (max-width: 1023px) {
		.mdsh-toc {
			display: none;
		}
	}
</style>
