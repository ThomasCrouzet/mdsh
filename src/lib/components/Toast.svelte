<script lang="ts">
	import { filesStore } from '$lib/files.svelte';
	import { t } from '$lib/i18n';
	import { RotateCcw } from '@lucide/svelte';

	function stripExt(name: string) {
		return name.replace(/\.(md|markdown|mdx|txt)$/i, '');
	}

	// §B1.2 - Caps at 3 visible toasts: on mobile, 5 toasts at ~50 px
	// each hid ~250 px (half an iPhone SE). Beyond that, a condensed
	// "and N more" toast gives the count without saturating the screen; the
	// hidden files remain restorable via a 2nd quick close
	// (the first toasts purge at 5 s, then the next ones rise up).
	const MAX_VISIBLE = 3;
	const visible = $derived(filesStore.trash.slice(0, MAX_VISIBLE));
	const overflow = $derived(Math.max(0, filesStore.trash.length - MAX_VISIBLE));
</script>

{#if filesStore.trash.length > 0}
	<div
		class="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2"
	>
		{#each visible as entry (entry.file.id)}
			<div
				class="pointer-events-auto flex items-center gap-3 rounded-md border border-border
				       bg-bg-1 px-3 py-2 text-sm text-fg shadow-lg animate-fade-in"
				role="status"
			>
				<span class="text-fg-muted">{t('toast.closed')}</span>
				<span class="font-medium">{stripExt(entry.file.name)}</span>
				<button
					class="ml-2 flex items-center gap-1.5 rounded px-2 py-1 text-accent transition hover:bg-bg-2"
					onclick={() => filesStore.restore(entry.file.id)}
					title={t('toast.undoClose')}
				>
					<RotateCcw size={13} />
					<span class="text-xs">{t('toast.undo')}</span>
				</button>
			</div>
		{/each}
		{#if overflow > 0}
			<div
				class="pointer-events-auto flex items-center justify-center gap-2 rounded-md border
				       border-border bg-bg-1 px-3 py-1.5 text-xs text-fg-muted shadow-lg"
				role="status"
				aria-live="polite"
			>
				{t('toast.overflowClosed', { n: overflow })}
			</div>
		{/if}
	</div>
{/if}
