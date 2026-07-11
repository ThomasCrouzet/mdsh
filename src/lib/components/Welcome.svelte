<script lang="ts">
	import { FilePlus, Upload, Compass } from 'lucide-svelte';
	import { formatKbd } from '$lib/platform';
	import { t } from '$lib/i18n';

	interface Props {
		onNew: () => void;
		onImport: () => void;
		onDemo: () => void;
	}

	let { onNew, onImport, onDemo }: Props = $props();
</script>

<div class="flex h-full flex-col items-center justify-center px-6 text-center">
	<!-- §B1.4 - semantic h1 for SR (previously: <div>). The visuals stay identical
	     via the typographic classes. -->
	<h1 class="mb-8 font-mono text-4xl font-normal tracking-tight">
		<span class="text-accent">$</span> mdsh
	</h1>

	<p class="mb-2 max-w-md text-sm text-fg-muted">
		{t('welcome.tagline')}<br />
		{t('welcome.taglineLine2')}
	</p>
	<p class="mb-10 max-w-md text-xs text-fg-subtle">
		{t('welcome.privacy')}
	</p>

	<div class="flex flex-col gap-2 sm:flex-row">
		<button
			class="flex items-center gap-2 rounded-md border border-border bg-bg-1 px-4 py-2
			       text-sm text-fg transition hover:border-border-strong hover:bg-bg-2"
			onclick={onNew}
		>
			<FilePlus size={16} />
			<span>{t('welcome.newFile')}</span>
			<kbd class="text-[10px] text-fg-dim">{formatKbd('⌘N')}</kbd>
		</button>
		<button
			class="flex items-center gap-2 rounded-md border border-border bg-bg-1 px-4 py-2
			       text-sm text-fg transition hover:border-border-strong hover:bg-bg-2"
			onclick={onImport}
		>
			<Upload size={16} />
			<span>{t('welcome.importMd')}</span>
			<kbd class="text-[10px] text-fg-dim">{formatKbd('⌘O')}</kbd>
		</button>
	</div>

	<button
		class="mt-4 flex items-center gap-2 rounded-md px-3 py-1.5 text-xs text-fg-muted
		       transition hover:text-fg"
		onclick={onDemo}
	>
		<Compass size={14} />
		<span>{t('welcome.openDemo')}</span>
	</button>

	<!-- §B4.2 - text-xs (12 px) rather than text-[10px]: 10 px fails the
	     default legibility criteria. fg-muted (instead of fg-dim,
	     §B1.6) to reach 5:1 on a dark background. -->
	<div class="mt-12 grid grid-cols-2 gap-x-8 gap-y-1 font-mono text-xs text-fg-muted">
		<div>{formatKbd('⌘S')}</div>
		<div class="text-left">{t('welcome.legendExport')}</div>
		<div>{formatKbd('⌘E')} / {formatKbd('⌘R')} / {formatKbd('⌘/')}</div>
		<div class="text-left">{t('welcome.legendModes')}</div>
		<div>{formatKbd('⌘B')}</div>
		<div class="text-left">{t('welcome.legendPanel')}</div>
		<div>{formatKbd('⌘W')}</div>
		<div class="text-left">{t('welcome.legendCloseTab')}</div>
	</div>
</div>
