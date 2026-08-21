<script lang="ts">
	import { tick } from 'svelte';
	import { browser } from '$app/environment';
	import { t } from '$lib/i18n';
	import { filesStore } from '$lib/files.svelte';
	import { workspaceStore } from '$lib/workspaces.svelte';
	import { templatesStore } from '$lib/templates.svelte';
	import { themeStore } from '$lib/ui/theme.svelte';
	import { promptStore } from '$lib/prompt.svelte';
	import { notify } from '$lib/notify.svelte';
	import { reportError } from '$lib/report';
	import { spinnerStore } from '$lib/spinner.svelte';
	import { copyMarkdown, copyRichHtml, isClipboardSupported } from '$lib/services/clipboard';
	import {
		runPaletteCopyActive,
		runPaletteDirectoryImport,
		runPaletteSaveTemplate,
		runPaletteSaveWorkspace
	} from '$lib/palette-ops';
	import { isDirectoryPickerSupported } from '$lib/fsa';
	import type { EditMode } from '$lib/types';
	import { EDITOR } from '$lib/config';
	import { focusTrap } from '$lib/a11y/focusTrap';
	import { formatKbd } from '$lib/platform';
	import {
		FilePlus,
		Upload,
		Download,
		Eye,
		Pencil,
		Code2,
		FileOutput,
		Files,
		PanelLeft,
		Printer,
		X,
		Search,
		MoveHorizontal,
		RotateCcw,
		Focus,
		List,
		Link2,
		Layers,
		Play,
		AlignVerticalJustifyCenter,
		Settings,
		SunMoon,
		FileText,
		Clipboard,
		ClipboardCopy,
		FolderOpen,
		History,
		Workflow
	} from '@lucide/svelte';

	interface Command {
		id: string;
		label: string;
		hint?: string;
		kbd?: string;
		icon: typeof FilePlus;
		run: () => void;
	}

	interface Props {
		open: boolean;
		onClose: () => void;
		onNew: () => void;
		onImport: () => void;
		onExportMd: () => void;
		onExportHtml: () => void;
		onExportPdf: () => void;
		onExportAll: () => void;
		onToggleSidebar: () => void;
		onSetMode: (m: EditMode) => void;
		onOpenSearch: () => void;
		onOpenInFileSearch: () => void;
		onSetEditorWidth: (px: number) => void;
		onResetEditorWidth: () => void;
		focusMode: boolean;
		onToggleFocus: () => void;
		typewriterMode: boolean;
		onToggleTypewriter: () => void;
		tocVisible: boolean;
		onToggleToc: () => void;
		onOpenDiskLinks: () => void;
		onOpenWorkspaces: () => void;
		onOpenSettings: () => void;
		onOpenHistory: () => void;
		onOpenGraph: () => void;
		onOpenPresentation: () => void;
	}

	let {
		open,
		onClose,
		onNew,
		onImport,
		onExportMd,
		onExportHtml,
		onExportPdf,
		onExportAll,
		onToggleSidebar,
		onSetMode,
		onOpenSearch,
		onOpenInFileSearch,
		onSetEditorWidth,
		onResetEditorWidth,
		focusMode,
		onToggleFocus,
		typewriterMode,
		onToggleTypewriter,
		tocVisible,
		onToggleToc,
		onOpenDiskLinks,
		onOpenWorkspaces,
		onOpenSettings,
		onOpenHistory,
		onOpenGraph,
		onOpenPresentation
	}: Props = $props();

	let query = $state('');
	let selected = $state(0);
	let inputEl: HTMLInputElement | null = $state(null);

	function stripExt(name: string) {
		return name.replace(/\.(md|markdown|mdx|txt)$/i, '');
	}

	// §2.3 - "Vault" import: opens a directory and creates a tab per .md file.
	async function importDirectory(): Promise<void> {
		try {
			await runPaletteDirectoryImport({
				importDirectory: () => filesStore.importDirectory(),
				showSpinner: (label) => spinnerStore.show(label),
				notifySuccess: (message) => notify.success(message),
				reportError,
				t
			});
		} catch {
			// reportError already toasted; keep the command fire-and-forget.
		}
	}

	// §2.5 - Copies the active file (raw markdown or rich HTML) to the
	// clipboard, with user feedback via toasts.
	async function copyActive(format: 'md' | 'html'): Promise<void> {
		await runPaletteCopyActive(format, {
			getActive: () => filesStore.active,
			isClipboardSupported,
			copyMarkdown,
			copyRichHtml,
			notifySuccess: (message) => notify.success(message),
			notifyError: (message) => notify.error(message),
			reportError,
			t
		});
	}

	const baseCommands: Command[] = $derived([
		{ id: 'new', label: t('palette.newFile'), kbd: formatKbd('⌘N'), icon: FilePlus, run: onNew },
		{
			id: 'import',
			label: t('palette.importMd'),
			kbd: formatKbd('⌘O'),
			icon: Upload,
			run: onImport
		},
		...(isDirectoryPickerSupported()
			? [
					{
						id: 'import-dir',
						label: t('palette.importDirectory'),
						hint: t('palette.importDirectoryHint'),
						icon: FolderOpen,
						run: () => void importDirectory()
					}
				]
			: []),
		{
			id: 'export-md',
			label: t('palette.exportMarkdown'),
			kbd: formatKbd('⌘S'),
			icon: Download,
			run: onExportMd
		},
		{
			id: 'export-pdf',
			label: t('palette.exportPdf'),
			kbd: formatKbd('⌘P'),
			icon: Printer,
			run: onExportPdf
		},
		{ id: 'export-html', label: t('palette.exportHtml'), icon: FileOutput, run: onExportHtml },
		{ id: 'export-all', label: t('palette.exportAll'), icon: Files, run: onExportAll },
		{
			id: 'copy-md',
			label: t('palette.copyMarkdown'),
			hint: t('palette.copyMarkdownHint'),
			icon: Clipboard,
			run: () => void copyActive('md')
		},
		{
			id: 'copy-html',
			label: t('palette.copyRichHtml'),
			hint: t('palette.copyRichHtmlHint'),
			icon: ClipboardCopy,
			run: () => void copyActive('html')
		},
		{
			id: 'mode-wysiwyg',
			label: t('palette.modeWysiwyg'),
			kbd: formatKbd('⌘E'),
			icon: Pencil,
			run: () => onSetMode('wysiwyg')
		},
		{
			id: 'mode-source',
			label: t('palette.modeSource'),
			kbd: formatKbd('⌘/'),
			icon: Code2,
			run: () => onSetMode('source')
		},
		{
			id: 'mode-read',
			label: t('palette.modeRead'),
			kbd: formatKbd('⌘R'),
			icon: Eye,
			run: () => onSetMode('read')
		},
		{
			id: 'sidebar',
			label: t('palette.toggleSidebar'),
			kbd: formatKbd('⌘B'),
			icon: PanelLeft,
			run: onToggleSidebar
		},
		{
			id: 'search-in-file',
			label: t('palette.searchInFile'),
			hint: t('palette.searchInFileHint'),
			kbd: formatKbd('⌘F'),
			icon: Search,
			run: onOpenInFileSearch
		},
		{
			id: 'search',
			label: t('palette.searchCrossFiles'),
			kbd: formatKbd('⌘⇧F'),
			icon: Search,
			run: onOpenSearch
		},
		{
			id: 'focus',
			label: focusMode ? t('palette.disableFocusMode') : t('palette.enableFocusMode'),
			hint: t('palette.focusModeHint'),
			kbd: formatKbd('⌘⇧.'),
			icon: Focus,
			run: onToggleFocus
		},
		{
			id: 'typewriter',
			label: typewriterMode ? t('palette.disableTypewriter') : t('palette.enableTypewriter'),
			hint: t('palette.typewriterHint'),
			icon: AlignVerticalJustifyCenter,
			run: onToggleTypewriter
		},
		{
			id: 'toc',
			label: tocVisible ? t('palette.hideToc') : t('palette.showToc'),
			hint: t('palette.tocHint'),
			icon: List,
			run: onToggleToc
		},
		{
			id: 'disk-links',
			label: t('palette.manageDiskLinks'),
			hint: t('palette.manageDiskLinksHint'),
			icon: Link2,
			run: onOpenDiskLinks
		},
		{
			id: 'workspaces-save',
			label: t('palette.saveWorkspace'),
			hint: t('palette.saveWorkspaceHint'),
			icon: Layers,
			// §B1.3 - Custom modal (cf. PromptModal + promptStore). We close the
			// palette before the prompt to avoid a nested focus-trap.
			run: () => {
				if (!browser) return;
				void runPaletteSaveWorkspace({
					promptName: () =>
						promptStore.prompt({
							title: t('palette.workspaceNamePrompt'),
							placeholder: t('palette.workspaceNamePlaceholder')
						}),
					save: (name) => workspaceStore.save(name),
					notifySuccess: (message) => notify.success(message),
					t
				});
			}
		},
		{
			id: 'workspaces-open',
			label: t('palette.loadWorkspace'),
			hint: t('palette.loadWorkspaceHint'),
			icon: Layers,
			run: onOpenWorkspaces
		},
		{
			id: 'settings',
			label: t('palette.settings'),
			hint: t('palette.settingsHint'),
			icon: Settings,
			run: onOpenSettings
		},
		{
			id: 'history',
			label: t('palette.versionHistory'),
			hint: t('palette.versionHistoryHint'),
			icon: History,
			run: onOpenHistory
		},
		{
			id: 'graph',
			label: t('palette.linksGraph'),
			hint: t('palette.linksGraphHint'),
			icon: Workflow,
			run: onOpenGraph
		},
		{
			id: 'presentation',
			label: t('palette.presentationMode'),
			hint: t('palette.presentationModeHint'),
			icon: Play,
			run: onOpenPresentation
		},
		{
			id: 'template-save',
			label: t('palette.saveAsTemplate'),
			hint: t('palette.saveAsTemplateHint'),
			icon: FileText,
			run: () => {
				if (!browser) return;
				void runPaletteSaveTemplate({
					getActive: () => filesStore.active,
					promptName: (defaultValue) =>
						promptStore.prompt({
							title: t('palette.templateNamePrompt'),
							defaultValue,
							placeholder: t('palette.templateNamePlaceholder')
						}),
					save: (name, content) => templatesStore.save(name, content),
					notifySuccess: (message) => notify.success(message),
					stripExt,
					t
				});
			}
		},
		{
			id: 'theme',
			label: t('palette.theme', {
				theme: t(
					themeStore.pref === 'system'
						? 'settings.themeSystem'
						: themeStore.pref === 'light'
							? 'settings.themeLight'
							: 'settings.themeDark'
				)
			}),
			hint: t('palette.themeHint'),
			icon: SunMoon,
			run: () => themeStore.cycle()
		},
		{
			id: 'width-prose',
			// 65ch at 17 px ≈ 720 px: prose sweet spot (Baymard, Nanavati 2005,
			// Ruder 1967, WCAG 1.4.8 AAA ≤ 80 cpl).
			label: t('palette.widthProse'),
			hint: t('palette.widthProseHint'),
			icon: MoveHorizontal,
			run: () => onSetEditorWidth(EDITOR.widthPresets.prose)
		},
		{
			id: 'width-narrow',
			label: t('palette.widthNarrow', { px: EDITOR.widthPresets.narrow }),
			icon: MoveHorizontal,
			run: () => onSetEditorWidth(EDITOR.widthPresets.narrow)
		},
		{
			id: 'width-medium',
			label: t('palette.widthMedium', { px: EDITOR.widthPresets.medium }),
			icon: MoveHorizontal,
			run: () => onSetEditorWidth(EDITOR.widthPresets.medium)
		},
		{
			id: 'width-wide',
			label: t('palette.widthWide', { px: EDITOR.widthPresets.wide }),
			icon: MoveHorizontal,
			run: () => onSetEditorWidth(EDITOR.widthPresets.wide)
		},
		{
			id: 'width-full',
			label: t('palette.widthFull'),
			icon: MoveHorizontal,
			run: () => onSetEditorWidth(9999)
		},
		{
			id: 'width-reset',
			label: t('palette.widthReset'),
			icon: RotateCcw,
			run: onResetEditorWidth
		}
	]);

	const fileCommands: Command[] = $derived(
		filesStore.files.map((f) => ({
			id: `file-${f.id}`,
			label: stripExt(f.name),
			hint: t('palette.openFileHint'),
			icon: FilePlus,
			run: () => filesStore.setActive(f.id)
		}))
	);

	// §6.8 - Direct "Load workspace «X»" commands: allow
	// restoring a workspace with a single search in the palette, without
	// going through the sub-modal. List populated on open (cf. $effect).
	const workspaceCommands: Command[] = $derived(
		workspaceStore.workspaces.map((ws) => ({
			id: `workspace-${ws.id}`,
			label: t('palette.loadWorkspaceNamed', { name: ws.name }),
			hint: t('palette.workspaceFileCount', { n: ws.fileIds.length }),
			icon: Play,
			run: () => void workspaceStore.restore(ws.id)
		}))
	);

	// §2.7 - "New from template" commands: create a pre-filled file
	// (dated builtin or user template) in one search. Variables substituted
	// at creation time (cf. templatesStore.resolve).
	const templateCommands: Command[] = $derived(
		templatesStore.choices.map((tpl) => ({
			id: `template-${tpl.id}`,
			label: t('palette.newFromTemplate', { name: tpl.name }),
			hint: tpl.description,
			icon: FileText,
			run: () => {
				const doc = templatesStore.resolve(tpl.id);
				if (doc) filesStore.createNew(doc.name, doc.content);
			}
		}))
	);

	const filtered: Command[] = $derived.by(() => {
		const all = [...baseCommands, ...templateCommands, ...workspaceCommands, ...fileCommands];
		const q = query.trim().toLowerCase();
		if (!q) return all;
		return all.filter((c) => c.label.toLowerCase().includes(q));
	});

	$effect(() => {
		if (open) {
			query = '';
			selected = 0;
			// Load workspaces + templates on first open so that
			// the direct commands appear in the list.
			void workspaceStore.load();
			void templatesStore.load();
			tick().then(() => inputEl?.focus());
		}
	});

	$effect(() => {
		const _ = query;
		void _;
		selected = 0;
	});

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			selected = Math.min(selected + 1, filtered.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selected = Math.max(selected - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const cmd = filtered[selected];
			if (cmd) {
				onClose();
				cmd.run();
			}
		}
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pb-4 backdrop-blur-sm
		       pt-[max(env(safe-area-inset-top),12vh)]"
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
		aria-label={t('palette.dialogLabel')}
		tabindex="-1"
		use:focusTrap
	>
		<div
			class="mdsh-dialog-panel flex w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border
			       bg-bg-1 shadow-2xl animate-fade-in"
		>
			<!-- §B1.5 - ARIA combobox + listbox pattern: the input drives the listbox
			     via aria-activedescendant. Before: no role nor announcement of
			     the highlighted item, the SR saw just a text field without context. -->
			<div class="palette-input-row flex items-center gap-2 border-b border-border px-3 py-3">
				<span class="font-mono text-xs text-accent" aria-hidden="true">&gt;_</span>
				<Search size={15} class="text-fg-dim" />
				<input
					bind:this={inputEl}
					bind:value={query}
					onkeydown={handleKey}
					type="text"
					placeholder={t('palette.inputPlaceholder')}
					class="min-w-0 flex-1 bg-transparent font-mono text-sm text-fg outline-none placeholder:text-fg-dim"
					spellcheck="false"
					autocapitalize="off"
					autocomplete="off"
					role="combobox"
					aria-controls="cmd-palette-listbox"
					aria-expanded={filtered.length > 0}
					aria-autocomplete="list"
					aria-activedescendant={filtered[selected]?.id != null
						? `cmd-palette-opt-${filtered[selected]!.id}`
						: undefined}
					aria-label={t('palette.inputLabel')}
				/>
				<button
					class="rounded p-1 text-fg-dim transition hover:bg-bg-2 hover:text-fg"
					onclick={onClose}
					aria-label={t('palette.close')}
				>
					<X size={14} />
				</button>
			</div>
			<div
				class="palette-meta flex items-center justify-between border-b border-border px-3 py-1.5"
			>
				<span>COMMAND INDEX</span>
				<span>{filtered.length.toString().padStart(2, '0')} AVAILABLE</span>
			</div>

			<ul
				id="cmd-palette-listbox"
				role="listbox"
				aria-label={t('palette.listboxLabel')}
				class="max-h-80 overflow-y-auto py-1.5"
			>
				{#if filtered.length === 0}
					<li class="px-4 py-6 text-center text-xs text-fg-dim" role="presentation">
						{t('palette.noCommand')}
					</li>
				{:else}
					{#each filtered as cmd, i (cmd.id)}
						<li
							role="option"
							id={`cmd-palette-opt-${cmd.id}`}
							aria-selected={i === selected}
							aria-label={cmd.kbd
								? t('palette.commandWithShortcut', { label: cmd.label, kbd: cmd.kbd })
								: cmd.label}
							class="palette-command flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left text-sm transition"
							class:bg-bg-2={i === selected}
							class:text-fg={i === selected}
							class:text-fg-muted={i !== selected}
							onclick={() => {
								onClose();
								cmd.run();
							}}
							onkeydown={(event) => {
								if (event.key === 'Enter' || event.key === ' ') {
									event.preventDefault();
									onClose();
									cmd.run();
								}
							}}
							onmousedown={(event) => event.preventDefault()}
							onmouseenter={() => (selected = i)}
						>
							<span class="palette-command-index" aria-hidden="true"
								>{(i + 1).toString().padStart(2, '0')}</span
							>
							<cmd.icon size={14} class="flex-shrink-0 text-fg-dim" aria-hidden="true" />
							<span class="flex-1 truncate">{cmd.label}</span>
							{#if cmd.kbd}
								<kbd class="flex-shrink-0 text-xs text-fg-dim" aria-hidden="true">{cmd.kbd}</kbd>
							{/if}
						</li>
					{/each}
				{/if}
			</ul>
		</div>
	</div>
{/if}

<style>
	.palette-input-row {
		background: color-mix(in oklab, var(--color-bg-2) 58%, transparent);
	}
	.palette-meta {
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: 0.14em;
		color: var(--color-fg-dim);
	}
	.palette-command {
		position: relative;
		border-block: 1px solid transparent;
	}
	.palette-command:hover,
	.palette-command[aria-selected='true'] {
		border-block-color: var(--color-border);
		background: linear-gradient(
			90deg,
			color-mix(in oklab, var(--color-accent) 13%, var(--color-bg-2)),
			var(--color-bg-2) 62%
		);
	}
	.palette-command[aria-selected='true']::before {
		content: '';
		position: absolute;
		inset-block: -1px;
		left: 0;
		width: 2px;
		background: var(--color-accent);
	}
	.palette-command-index {
		width: 1.6rem;
		flex: none;
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: 0.08em;
		color: var(--color-fg-dim);
	}
	.palette-command[aria-selected='true'] .palette-command-index {
		color: var(--color-accent);
	}
</style>
