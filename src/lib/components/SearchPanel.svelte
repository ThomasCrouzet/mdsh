<script lang="ts">
	import { tick, onMount, untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { filesStore } from '$lib/files.svelte';
	import { t } from '$lib/i18n';
	import { promptStore } from '$lib/prompt.svelte';
	import { notify } from '$lib/notify.svelte';
	import { reportError } from '$lib/report';
	import { replaceInFiles } from '$lib/replace';
	import type { Hit } from '$lib/types';
	import type { SearchRequest, SearchResponse } from '$lib/workers/search.worker';
	import { corpusFingerprint } from '$lib/search-core';
	import { focusTrap } from '$lib/a11y/focusTrap';
	import { Search, X, CaseSensitive, Regex, WholeWord, Replace } from 'lucide-svelte';

	interface Props {
		open: boolean;
		onClose: () => void;
		/** §B3.7 - Callback: open a hit in the source editor at the targeted line
		 *  with the query preloaded in the CodeMirror panel. If not provided, fallback
		 *  to a plain `filesStore.setActive`. */
		onOpenHit?: (fileId: string, line: number, query: string) => void;
	}

	let { open, onClose, onOpenHit }: Props = $props();

	let query = $state('');
	// Debounced query (120 ms): avoids the split×lines of every file
	// on each keystroke. Measurable gain from ~20 moderately-sized files.
	let debouncedQuery = $state('');
	let selected = $state(0);
	let inputEl: HTMLInputElement | null = $state(null);

	// §B3.8 - Search options. Persisted in localStorage to keep
	// the preference across sessions; reset on reload if IDB is cleared.
	let caseSensitive = $state(false);
	let wholeWord = $state(false);
	let useRegex = $state(false);
	let regexError = $state<string | null>(null);

	// §2.6 - Cross-file replacement (opt-in: toggled via the replace button).
	let showReplace = $state(false);
	let replacement = $state('');

	// §A4.1 - Search is offloaded to a Web Worker (cf.
	// `src/lib/workers/search.worker.ts`) so as not to block the main thread
	// on large corpora. The worker is created once on mount and terminated on
	// the component's unmount. Each request carries an incremental `id`; we
	// ignore responses whose id is no longer the latest - equivalent to
	// cancellation without interrupting the worker (which is single-threaded but
	// stays responsive to subsequent messages).
	let hits = $state<Hit[]>([]);
	let worker: Worker | null = null;
	let nextQueryId = 0;
	let lastSentQueryId = 0;
	/** Fingerprint of the last corpus posted to the worker - skip full
	 *  structured-clone when the snapshot is unchanged (id + updatedAt). */
	let lastCorpusFingerprint = '';

	onMount(() => {
		if (!browser) return;
		worker = new Worker(new URL('$lib/workers/search.worker.ts', import.meta.url), {
			type: 'module'
		});
		worker.addEventListener('message', (e: MessageEvent<SearchResponse>) => {
			// Ignore stale responses (the user typed in the meantime).
			if (e.data.id !== lastSentQueryId) return;
			hits = e.data.hits;
			regexError = e.data.regexError;
		});
		// Load/parse failure of the worker script: without this handler, the error
		// is swallowed (no results, no feedback). We surface it to the user.
		worker.addEventListener('error', (e) => {
			reportError('search-worker', e.message ?? String(e));
			notify.error(t('search.unavailable'));
		});
		return () => {
			worker?.terminate();
			worker = null;
		};
	});

	function stripExt(name: string) {
		return name.replace(/\.(md|markdown|mdx|txt)$/i, '');
	}

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		const q = query;
		if (debounceTimer) clearTimeout(debounceTimer);
		// Instant feedback for queries that are too short (already filtered out).
		if (q.trim().length < 2) {
			debouncedQuery = q;
			return;
		}
		debounceTimer = setTimeout(() => {
			debouncedQuery = q;
		}, 120);
	});

	// Sends the request to the worker as soon as `debouncedQuery` or the options
	// change. When the panel is closed we send nothing (CPU savings if
	// the user closes before the debounce finishes, for example).
	$effect(() => {
		const q = debouncedQuery.trim();
		const _opts = [caseSensitive, wholeWord, useRegex];
		void _opts;
		if (!open) return;
		if (q.length < 2) {
			hits = [];
			regexError = null;
			return;
		}
		if (!worker) return;
		const id = ++nextQueryId;
		lastSentQueryId = id;
		// `untrack`: do not subscribe to file content mutations.
		// Without it, any keystroke in the editor re-posts the whole corpus to the worker.
		// The effect only re-triggers on the debounced query and the options.
		// Fingerprint only needs id+updatedAt (O(N)); clone full content only when
		// the corpus actually changed so each keystroke does not copy megabytes.
		const meta = untrack(() =>
			filesStore.files.map((f) => ({
				id: f.id,
				updatedAt: f.updatedAt
			}))
		);
		const fingerprint = corpusFingerprint(meta);
		const corpusChanged = fingerprint !== lastCorpusFingerprint;
		if (corpusChanged) lastCorpusFingerprint = fingerprint;
		const req: SearchRequest = {
			id,
			query: q,
			caseSensitive,
			wholeWord,
			useRegex,
			...(corpusChanged
				? {
						files: untrack(() =>
							filesStore.files.map((f) => ({
								id: f.id,
								name: f.name,
								content: f.content
							}))
						)
					}
				: {})
		};
		worker.postMessage(req);
	});

	$effect(() => {
		if (open) {
			selected = 0;
			tick().then(() => inputEl?.focus());
		}
	});

	$effect(() => {
		const _ = query;
		void _;
		selected = 0;
	});

	function openHit(h: Hit) {
		// §B3.7 - Switches to source mode + scrolls to the line + preloads the query
		// in the CodeMirror search panel (callback handled by +page.svelte).
		// Fallback: if no callback, just setActive (legacy).
		if (onOpenHit) {
			onOpenHit(h.fileId, h.line, debouncedQuery);
		} else {
			filesStore.setActive(h.fileId);
		}
		onClose();
	}

	// §2.6 - Replaces all occurrences across all files, after
	// previewing the count + confirmation. Modifications go through
	// updateContent → history snapshot → undoable via the history.
	async function handleReplaceAll(): Promise<void> {
		const q = debouncedQuery.trim();
		if (q.length < 2) return;
		const opts = { caseSensitive, wholeWord, useRegex };
		const slices = filesStore.files.map((f) => ({ id: f.id, name: f.name, content: f.content }));
		const preview = replaceInFiles(slices, q, replacement, opts);
		if (preview.regexError) {
			regexError = preview.regexError;
			return;
		}
		if (preview.total === 0) {
			notify.info(t('search.noOccurrence'));
			return;
		}
		const ok = await promptStore.confirm({
			title: t('search.confirmTitle', { n: preview.total }),
			message:
				t('search.confirmInFiles', { n: preview.results.length }) +
				' ' +
				t('search.confirmUndoable'),
			confirmLabel: t('search.replaceAll'),
			danger: true
		});
		if (!ok) return;
		const res = filesStore.replaceInAll(q, replacement, opts);
		notify.success(t('search.replacedSummary', { n: res.occurrences, files: res.files }));
		onClose();
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			selected = Math.min(selected + 1, hits.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selected = Math.max(selected - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const hit = hits[selected];
			if (hit) openHit(hit);
		}
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pb-4 backdrop-blur-sm
		       pt-[max(env(safe-area-inset-top),10vh)]"
		style:padding-left="max(env(safe-area-inset-left), 1rem)"
		style:padding-right="max(env(safe-area-inset-right), 1rem)"
		onclick={(e) => {
			if (e.target === e.currentTarget) onClose();
		}}
		onkeydown={(e) => {
			if (e.key === 'Escape') onClose();
		}}
		role="dialog"
		aria-modal="true"
		aria-label={t('search.dialogLabel')}
		tabindex="-1"
		use:focusTrap
	>
		<div
			class="flex w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border
			       bg-bg-1 shadow-2xl animate-fade-in"
		>
			<!-- §B1.5 - ARIA combobox + listbox pattern identical to CommandPalette. -->
			<div class="flex items-center gap-2 border-b border-border px-3 py-2">
				<Search size={16} class="text-fg-dim" />
				<input
					bind:this={inputEl}
					bind:value={query}
					onkeydown={handleKey}
					type="text"
					placeholder={t('search.placeholder')}
					class="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-dim"
					spellcheck="false"
					autocapitalize="off"
					autocomplete="off"
					role="combobox"
					aria-controls="search-listbox"
					aria-expanded={hits.length > 0}
					aria-autocomplete="list"
					aria-activedescendant={hits[selected]?.fileId != null
						? `search-hit-${hits[selected]!.fileId}-${hits[selected]!.line}-${selected}`
						: undefined}
					aria-label={t('search.inputLabel')}
				/>
				<!-- §B3.8 - Option toggles: Aa (case), \b (whole word), .* (regex). -->
				<button
					type="button"
					class="rounded p-1 text-fg-dim transition hover:bg-bg-2"
					class:bg-bg-2={caseSensitive}
					class:text-accent={caseSensitive}
					class:hover:text-fg={!caseSensitive}
					onclick={() => (caseSensitive = !caseSensitive)}
					aria-pressed={caseSensitive}
					title={t('search.caseSensitive')}
					aria-label={t('search.caseSensitiveLabel')}
				>
					<CaseSensitive size={14} />
				</button>
				<button
					type="button"
					class="rounded p-1 text-fg-dim transition hover:bg-bg-2 disabled:cursor-not-allowed disabled:opacity-40"
					class:bg-bg-2={wholeWord && !useRegex}
					class:text-accent={wholeWord && !useRegex}
					class:hover:text-fg={!wholeWord && !useRegex}
					onclick={() => (wholeWord = !wholeWord)}
					disabled={useRegex}
					aria-pressed={wholeWord && !useRegex}
					title={useRegex ? t('search.wholeWordDisabled') : t('search.wholeWord')}
					aria-label={t('search.wholeWordLabel')}
				>
					<WholeWord size={14} />
				</button>
				<button
					type="button"
					class="rounded p-1 text-fg-dim transition hover:bg-bg-2"
					class:bg-bg-2={useRegex}
					class:text-accent={useRegex}
					class:hover:text-fg={!useRegex}
					onclick={() => (useRegex = !useRegex)}
					aria-pressed={useRegex}
					title={t('search.regex')}
					aria-label={t('search.regexLabel')}
				>
					<Regex size={14} />
				</button>
				<!-- §2.6 - Toggles replacement mode. -->
				<button
					type="button"
					class="rounded p-1 text-fg-dim transition hover:bg-bg-2"
					class:bg-bg-2={showReplace}
					class:text-accent={showReplace}
					class:hover:text-fg={!showReplace}
					onclick={() => (showReplace = !showReplace)}
					aria-pressed={showReplace}
					title={t('search.replaceInFiles')}
					aria-label={t('search.replaceToggleLabel')}
				>
					<Replace size={14} />
				</button>
				{#if debouncedQuery.trim().length >= 2 && !regexError}
					<span class="text-xs text-fg-dim" aria-live="polite" aria-atomic="true"
						>{t('search.resultCount', { n: hits.length })}</span
					>
				{/if}
				<button
					class="rounded p-1 text-fg-dim transition hover:bg-bg-2 hover:text-fg"
					onclick={onClose}
					aria-label={t('search.close')}
				>
					<X size={14} />
				</button>
			</div>

			{#if showReplace}
				<!-- §2.6 - Cross-file replacement row. -->
				<div class="flex items-center gap-2 border-b border-border px-3 py-2">
					<Replace size={16} class="text-fg-dim" aria-hidden="true" />
					<input
						bind:value={replacement}
						type="text"
						placeholder={t('search.replaceWith')}
						class="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-dim"
						spellcheck="false"
						autocapitalize="off"
						autocomplete="off"
						aria-label={t('search.replacementLabel')}
					/>
					<button
						type="button"
						class="shrink-0 rounded border border-border px-2.5 py-1 text-xs text-fg-muted transition hover:bg-bg-2 hover:text-fg disabled:opacity-40"
						onclick={() => void handleReplaceAll()}
						disabled={debouncedQuery.trim().length < 2}
					>
						{t('search.replaceAll')}
					</button>
				</div>
			{/if}

			{#if regexError}
				<div
					class="border-b border-border bg-danger/10 px-3 py-1.5 text-xs text-danger"
					role="alert"
				>
					{t('search.invalidRegex', { error: regexError })}
				</div>
			{/if}

			<ul
				id="search-listbox"
				role="listbox"
				aria-label={t('search.resultsLabel')}
				class="max-h-[60vh] overflow-y-auto py-1"
			>
				{#if query.trim().length < 2}
					<li class="px-4 py-6 text-center text-xs text-fg-dim" role="presentation">
						{t('search.minChars')}
					</li>
				{:else if hits.length === 0}
					<li class="px-4 py-6 text-center text-xs text-fg-dim" role="presentation">
						{t('search.noResult')}
					</li>
				{:else}
					{#each hits as hit, i (hit.fileId + ':' + hit.line + ':' + i)}
						<li
							role="option"
							id={`search-hit-${hit.fileId}-${hit.line}-${i}`}
							aria-selected={i === selected}
						>
							<button
								class="flex w-full flex-col gap-1 px-3 py-2 text-left transition"
								class:bg-bg-2={i === selected}
								onclick={() => openHit(hit)}
								onmouseenter={() => (selected = i)}
								tabindex="-1"
							>
								<div class="flex items-center gap-2 text-xs text-fg-muted">
									<span class="truncate font-medium">{stripExt(hit.name)}</span>
									<span class="text-fg-dim">:{hit.line}</span>
								</div>
								<div class="truncate font-mono text-xs text-fg">
									{hit.snippet.slice(0, hit.matchStart)}<mark
										class="bg-accent/25 text-accent rounded-sm px-0.5"
										>{hit.snippet.slice(hit.matchStart, hit.matchEnd)}</mark
									>{hit.snippet.slice(hit.matchEnd)}
								</div>
							</button>
						</li>
					{/each}
				{/if}
			</ul>
		</div>
	</div>
{/if}
