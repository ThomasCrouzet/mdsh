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
	import { i18n, t } from '$lib/i18n';
	import { blockEditLabels, toolbarLabels } from '$lib/editor-labels';
	import { notify } from '$lib/notify.svelte';
	import {
		editorImageSource,
		embedImageFile,
		ImageFileError,
		MAX_IMAGE_BYTES
	} from '$lib/render/image-media';
	import { ImageMarkdownRoundTrip } from '$lib/render/image-markdown';

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
	let imageRoundTrip: ImageMarkdownRoundTrip | null = null;
	let imageObserver: MutationObserver | null = null;
	let loadError = $state(false);
	let retryVersion = $state(0);
	let mountToken = 0;
	let lastEditorMarkdown = '';
	let updateExternalContent: ((markdown: string) => Promise<void>) | null = null;
	let removeFlushListener: (() => void) | null = null;
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
			})().catch((error) => {
				crepeModulePromise = null;
				throw error;
			});
		}
		return crepeModulePromise;
	}

	async function mount(initial: string, token: number, idForMount: string) {
		if (!container) return;
		loadError = false;
		const { Crepe } = await loadCrepeModule();
		if (token !== mountToken) return;
		let roundTrip = new ImageMarkdownRoundTrip(initial);
		lastEditorMarkdown = initial;
		const applyImageAlternatives = () => {
			const alternatives = roundTrip.alternatives;
			container
				.querySelectorAll<HTMLImageElement>('.milkdown-image-block img')
				.forEach((image, index) => {
					const alt = alternatives[index] ?? '';
					if (image.alt !== alt) image.alt = alt;
					image.referrerPolicy = 'no-referrer';
					image.crossOrigin = 'anonymous';
				});
		};
		const instance = new Crepe({
			root: container,
			defaultValue: roundTrip.editorMarkdown,
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
				[Crepe.Feature.BlockEdit]: blockEditLabels(),
				[Crepe.Feature.Toolbar]: toolbarLabels(),
				[Crepe.Feature.LinkTooltip]: { inputPlaceholder: t('editor.linkPlaceholder') },
				[Crepe.Feature.ImageBlock]: {
					blockUploadButton: t('editor.imageUpload'),
					inlineUploadButton: t('editor.imageUpload'),
					blockUploadPlaceholderText: t('editor.imageLinkPlaceholder'),
					inlineUploadPlaceholderText: t('editor.imageLinkPlaceholder'),
					blockCaptionPlaceholderText: t('editor.imageCaption'),
					blockConfirmButton: t('prompt.confirm'),
					inlineConfirmButton: t('prompt.confirm'),
					proxyDomURL: editorImageSource,
					onUpload: async (file: File) => {
						try {
							const embedded = await embedImageFile(file);
							roundTrip.registerUpload(embedded.dataUri, embedded.alt);
							return embedded.dataUri;
						} catch (error) {
							const limitMb = String(MAX_IMAGE_BYTES / (1024 * 1024));
							if (error instanceof ImageFileError && error.code === 'too-large') {
								notify.error(t('imageDrop.tooLargeOne', { name: file.name, limitMb }));
							} else {
								notify.error(t('imageDrop.unreadable', { n: 1 }));
							}
							throw error;
						}
					},
					onImageLoadError: () => {
						notify.error(t('imageDrop.unreadable', { n: 1 }));
					}
				},
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
				const portableMarkdown = roundTrip.restore(md);
				if (token === mountToken) lastEditorMarkdown = portableMarkdown;
				queueMicrotask(applyImageAlternatives);
				// §C1 - If the instance is still the current one, normal keystroke ->
				// onChange (writes to the active file). Otherwise (a late event
				// arriving after a remount), we explicitly route to the file
				// associated with THIS instance so we do not drop the last keystroke.
				if (token === mountToken) onChange(portableMarkdown);
				else onFlush?.(idForMount, portableMarkdown);
			});
		});
		try {
			await instance.create();
		} catch (err) {
			if (token === mountToken) loadError = true;
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
		imageRoundTrip = roundTrip;
		imageObserver = new MutationObserver(applyImageAlternatives);
		imageObserver.observe(container, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ['src', 'alt']
		});
		applyImageAlternatives();
		mountedFileId = idForMount;
		const flushCurrentContent = () => {
			if (token !== mountToken) return;
			const markdown = roundTrip.restore(instance.getMarkdown());
			lastEditorMarkdown = markdown;
			onFlush?.(idForMount, markdown);
		};
		window.addEventListener('mdsh:flush-editor', flushCurrentContent);
		removeFlushListener = () =>
			window.removeEventListener('mdsh:flush-editor', flushCurrentContent);
		updateExternalContent = async (markdown: string) => {
			if (markdown === lastEditorMarkdown) return;
			const { replaceAll } = await import('@milkdown/kit/utils');
			if (token !== mountToken || markdown !== content || idForMount !== fileId) return;
			roundTrip = new ImageMarkdownRoundTrip(markdown);
			imageRoundTrip = roundTrip;
			lastEditorMarkdown = markdown;
			instance.editor.action(replaceAll(roundTrip.editorMarkdown));
			applyImageAlternatives();
		};
		if (content !== initial && fileId === idForMount) await updateExternalContent(content);
	}

	async function unmount() {
		removeFlushListener?.();
		removeFlushListener = null;
		updateExternalContent = null;
		imageObserver?.disconnect();
		imageObserver = null;
		if (crepe) {
			const instance = crepe;
			const id = mountedFileId;
			crepe = null;
			const roundTrip = imageRoundTrip;
			imageRoundTrip = null;
			mountedFileId = null;
			// §C1 - Before destroying the outgoing instance, we re-read its current
			// markdown (synchronous Crepe API) and flush it one last time to ITS
			// file. Milkdown emits `markdownUpdated` asynchronously: without this
			// flush, the keystroke typed just before a tab switch would be lost
			// (the late event is rejected by the `token === mountToken` guard).
			if (id && onFlush) {
				try {
					onFlush(id, roundTrip?.restore(instance.getMarkdown()) ?? instance.getMarkdown());
				} catch (err) {
					reportError('Crepe flush on unmount', err);
				}
			}
			await instance.destroy().catch(() => {});
		}
	}

	$effect(() => {
		const id = fileId;
		void retryVersion;
		void i18n.locale;
		const snapshot = untrack(() => content);
		const token = ++mountToken;
		void (async () => {
			await unmount();
			if (token !== mountToken) return;
			await mount(snapshot, token, id);
		})().catch((error) => {
			if (token !== mountToken) return;
			loadError = true;
			reportError('visual editor load', error);
		});
	});

	$effect(() => {
		const ro = readonly;
		if (crepe) crepe.setReadonly(ro);
	});

	$effect(() => {
		const incoming = content;
		if (incoming === lastEditorMarkdown || !updateExternalContent) return;
		void updateExternalContent(incoming).catch((error) =>
			reportError('visual editor update', error)
		);
	});

	onDestroy(() => {
		mountToken++;
		void unmount();
	});
</script>

{#if loadError}
	<div class="mdsh-editor-error" role="alert">
		<p>{t('editor.loadErrorTitle')}</p>
		<p>{t('source.loadErrorHint')}</p>
		<button type="button" onclick={() => retryVersion++}>{t('source.retry')}</button>
	</div>
{/if}
<div bind:this={container} class="mdsh-editor"></div>

<style>
	.mdsh-editor {
		height: 100%;
		width: 100%;
		overflow-y: auto;
	}
	.mdsh-editor-error {
		margin: 1rem;
		padding: 1rem;
		border: 1px solid var(--color-border);
		color: var(--color-fg);
		background: var(--color-bg-1);
	}
	.mdsh-editor-error button {
		margin-top: 0.75rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border-strong);
		background: var(--color-bg-2);
		color: var(--color-fg);
	}
</style>
