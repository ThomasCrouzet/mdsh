<script lang="ts">
	import { tick } from 'svelte';
	import { filesStore } from '$lib/files.svelte';
	import { t, i18n } from '$lib/i18n';
	import { normalizeCommandSearch } from '$lib/ui/commands';
	import { focusTrap } from '$lib/a11y/focusTrap';
	import { promptStore } from '$lib/prompt.svelte';
	import { X, Search, Trash2 } from '@lucide/svelte';
	let { onClose }: { onClose: () => void } = $props();
	let input: HTMLInputElement | undefined = $state();
	let query = $state('');
	let scope = $state('all');
	const openIds = $derived(new Set(filesStore.files.map((file) => file.id)));
	const unresolved = $derived(
		filesStore.library.flatMap((file) =>
			filesStore
				.wikiLinkTargets(file.id)
				.filter((target) => !filesStore.resolveWikiLink(target))
				.map((target) => ({ file, target }))
		)
	);
	const matches = $derived(
		filesStore.library
			.filter((file) => {
				if (scope === 'open' && !openIds.has(file.id)) return false;
				if (scope === 'closed' && openIds.has(file.id)) return false;
				return normalizeCommandSearch(
					`${file.name} ${filesStore.documentTitle(file.id)} ${filesStore.getTags(file.id).join(' ')}`
				).includes(normalizeCommandSearch(query.trim()));
			})
			.sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name))
	);
	$effect(() => {
		void tick().then(() => input?.focus());
	});
	function open(id: string) {
		filesStore.openDocument(id);
		onClose();
	}
	async function remove(id: string) {
		if (
			await promptStore.confirm({
				title: t('sidebar.deleteConfirm'),
				message: t('sidebar.deleteMessage'),
				danger: true
			})
		) {
			filesStore.delete(id);
			await tick();
			input?.focus();
		}
	}
</script>

<div
	class="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[max(env(safe-area-inset-top),8vh)]"
	role="dialog"
	aria-modal="true"
	aria-label={t('library.title')}
	inert={promptStore.open}
	aria-hidden={promptStore.open ? 'true' : undefined}
	tabindex="-1"
	use:focusTrap
	onclick={(event) => {
		if (event.target === event.currentTarget) onClose();
	}}
	onkeydown={(event) => {
		if (event.key === 'Escape') onClose();
	}}
>
	<section
		class="mdsh-dialog-panel flex max-h-[80dvh] w-full max-w-2xl flex-col border border-border bg-bg-1 shadow-xl"
	>
		<header class="flex items-center gap-3 border-b border-border px-4 py-3">
			<h2 class="flex-1 text-sm font-medium">
				{t('library.title')} <span class="text-fg-muted">({filesStore.library.length})</span>
			</h2>
			<button class="rounded p-2" onclick={onClose} aria-label={t('settings.close')}
				><X size={16} /></button
			>
		</header>
		<label class="flex items-center gap-2 px-4 py-3"
			><Search size={16} /><input
				bind:this={input}
				bind:value={query}
				class="min-w-0 flex-1 rounded border border-border bg-bg px-3 py-2 text-sm"
				aria-label={t('library.filter')}
				placeholder={t('library.filter')}
				onkeydown={(event) => {
					if (event.key === 'Enter' && matches[0]) open(matches[0].id);
				}}
			/></label
		>
		<div class="flex flex-wrap gap-2 px-4 pb-3" role="group" aria-label={t('library.scope')}>
			{#each ['all', 'open', 'closed'] as value (value)}<button
					class="rounded border border-border px-3 py-2 text-xs"
					class:text-accent={scope === value}
					aria-pressed={scope === value}
					onclick={() => (scope = value)}
					>{t(
						value === 'all' ? 'library.all' : value === 'open' ? 'library.open' : 'library.closed'
					)}</button
				>{/each}
		</div>
		{#if unresolved.length}
			<details
				class="max-h-48 overflow-y-auto border-t border-border px-4 py-2 text-xs text-fg-muted"
			>
				<summary class="cursor-pointer py-1"
					>{t('library.unresolved', { n: unresolved.length })}</summary
				>
				<p class="py-2">{t('library.repairHint')}</p>
				{#each unresolved.slice(0, 200) as link (link.file.id + ':' + link.target)}<button
						class="block w-full truncate py-2 text-left underline"
						onclick={() => open(link.file.id)}>{link.file.name} → [[{link.target}]]</button
					>{/each}
			</details>
		{/if}
		<ul class="min-h-0 flex-1 overflow-y-auto border-t border-border">
			{#each matches as file (file.id)}
				<li class="flex items-center border-b border-border px-2">
					<button
						class="flex min-w-0 flex-1 flex-col gap-1 p-3 text-left hover:bg-bg-2"
						onclick={() => open(file.id)}
						aria-label={t('library.openDocument', { name: file.name })}
					>
						<span class="max-w-full truncate text-sm font-medium">{file.name}</span>
						<span class="max-w-full truncate text-xs text-fg-muted"
							>{filesStore.documentTitle(file.id)} · {new Intl.DateTimeFormat(i18n.locale, {
								dateStyle: 'medium',
								timeStyle: 'short'
							}).format(file.updatedAt)}</span
						>
						<span class="text-xs text-fg-muted"
							>{t(
								openIds.has(file.id) ? 'library.open' : 'library.closed'
							)}{#each filesStore.getTags(file.id) as tag (tag)}
								· #{tag}{/each}</span
						>
					</button>
					<button
						class="rounded p-3 text-fg-muted hover:text-danger"
						onclick={() => void remove(file.id)}
						aria-label={`${t('palette.deleteFile')}: ${file.name}`}><Trash2 size={16} /></button
					>
				</li>
			{:else}<li class="p-6 text-center text-sm text-fg-muted">{t('library.empty')}</li>{/each}
		</ul>
	</section>
</div>
