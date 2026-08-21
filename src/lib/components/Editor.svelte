<script lang="ts">
	// Milkdown Crepe wrapper.
	// Milkdown + its CSS themes + our `milkdown.css` override are loaded
	// dynamically on first mount - kept out of the initial bundle (~500 KiB
	// estimated savings on the page chunk). The first WYSIWYG mode opening
	// pays an extra ~150 ms of loading, while the read/source modes
	// (default for onboarding) become instant.

	import type { Crepe as CrepeType } from '@milkdown/crepe';
	import { onDestroy, untrack } from 'svelte';
	import { renderMermaidPreview } from '../milkdown-mermaid-preview';
	import { reportError } from '$lib/report';
	import { t } from '$lib/i18n';

	interface Props {
		fileId: string;
		content: string;
		readonly?: boolean;
		onChange: (markdown: string) => void;
		// §C1 - Flush of the last keystroke to the OLD file before remount.
		// Explicitly receives the relevant fileId (unlike onChange which writes to
		// the active file): on tab switch, the outgoing instance may hold a
		// keystroke that `markdownUpdated` (asynchronous) has not yet emitted.
		onFlush?: (fileId: string, markdown: string) => void;
	}

	let { fileId, content, readonly = false, onChange, onFlush }: Props = $props();

	let container: HTMLElement;
	let crepe: CrepeType | null = null;
	let mountToken = 0;
	// §C1 - fileId associated with the currently mounted Crepe instance. Captured
	// at mount to correctly route a late keystroke (flush or asynchronous
	// `markdownUpdated`) to the right file even after a tab switch.
	let mountedFileId: string | null = null;

	// Module cache: loaded on first call, reused afterwards.
	// CSS import order is critical: Crepe defaults -> frame-dark -> our overrides.
	let crepeModulePromise: Promise<typeof import('@milkdown/crepe')> | null = null;
	function loadCrepeModule(): Promise<typeof import('@milkdown/crepe')> {
		if (!crepeModulePromise) {
			crepeModulePromise = (async () => {
				await import('@milkdown/crepe/theme/common/style.css');
				await import('@milkdown/crepe/theme/frame-dark.css');
				await import('../milkdown.css');
				return import('@milkdown/crepe');
			})();
		}
		return crepeModulePromise;
	}

	async function mount(initial: string, token: number, idForMount: string) {
		if (!container) return;
		const { Crepe } = await loadCrepeModule();
		if (token !== mountToken) return;
		const instance = new Crepe({
			root: container,
			defaultValue: initial,
			features: {
				[Crepe.Feature.CodeMirror]: true,
				[Crepe.Feature.ListItem]: true,
				[Crepe.Feature.LinkTooltip]: true,
				[Crepe.Feature.Cursor]: true,
				[Crepe.Feature.ImageBlock]: true,
				[Crepe.Feature.BlockEdit]: true,
				[Crepe.Feature.Placeholder]: true,
				[Crepe.Feature.Toolbar]: true,
				[Crepe.Feature.Table]: true,
				[Crepe.Feature.Latex]: true,
				[Crepe.Feature.TopBar]: false
			},
			featureConfigs: {
				[Crepe.Feature.Placeholder]: {
					text: t('editor.placeholder'),
					mode: 'block'
				},
				// Mermaid live-preview: we hook into the Crepe code-block's
				// `renderPreview` (cf. @milkdown/components/src/code-block/config.ts).
				// Latex already uses this hook (chained via `prev.renderPreview`);
				// the chain falls through to our function when the language is not
				// `latex` - where we filter `mermaid` and lazy-load the lib.
				[Crepe.Feature.CodeMirror]: {
					previewLabel: t('editor.previewLabel'),
					previewLoading: t('editor.previewLoading'),
					renderPreview: renderMermaidPreview
				}
			}
		});
		instance.on((listener) => {
			listener.markdownUpdated((_ctx, md) => {
				// §C1 - If the instance is still the current one, normal keystroke ->
				// onChange (writes to the active file). Otherwise (a late event
				// arriving after a remount), we explicitly route to the file
				// associated with THIS instance so we do not drop the last keystroke.
				if (token === mountToken) onChange(md);
				else onFlush?.(idForMount, md);
			});
		});
		try {
			await instance.create();
		} catch (err) {
			reportError('Crepe mount', err);
			await instance.destroy().catch(() => {});
			return;
		}
		if (token !== mountToken) {
			await instance.destroy().catch(() => {});
			return;
		}
		const proseMirror = container.querySelector<HTMLElement>('.ProseMirror');
		proseMirror?.setAttribute('aria-label', t('editor.ariaLabel'));
		instance.setReadonly(readonly);
		crepe = instance;
		mountedFileId = idForMount;
	}

	async function unmount() {
		if (crepe) {
			const instance = crepe;
			const id = mountedFileId;
			crepe = null;
			mountedFileId = null;
			// §C1 - Before destroying the outgoing instance, we re-read its current
			// markdown (synchronous Crepe API) and flush it one last time to ITS
			// file. Milkdown emits `markdownUpdated` asynchronously: without this
			// flush, the keystroke typed just before a tab switch would be lost
			// (the late event is rejected by the `token === mountToken` guard).
			if (id && onFlush) {
				try {
					onFlush(id, instance.getMarkdown());
				} catch (err) {
					reportError('Crepe flush on unmount', err);
				}
			}
			await instance.destroy().catch(() => {});
		}
	}

	$effect(() => {
		const id = fileId;
		const snapshot = untrack(() => content);
		const token = ++mountToken;
		(async () => {
			await unmount();
			if (token !== mountToken) return;
			await mount(snapshot, token, id);
		})();
	});

	$effect(() => {
		const ro = readonly;
		if (crepe) crepe.setReadonly(ro);
	});

	onDestroy(() => {
		mountToken++;
		void unmount();
	});
</script>

<div bind:this={container} class="mdsh-editor"></div>

<style>
	.mdsh-editor {
		height: 100%;
		width: 100%;
		overflow-y: auto;
	}
</style>
