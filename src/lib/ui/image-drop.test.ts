import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	appendImagesToActive,
	MAX_IMAGE_BYTES,
	isFilesDrag,
	fileToDataUri,
	buildDropHandlers
} from './image-drop.svelte';
import { notify } from '$lib/notify.svelte';
import { i18n } from '$lib/i18n';

const PNG_BYTES = Uint8Array.from(
	atob(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDfoAAAAASUVORK5CYII='
	),
	(character) => character.charCodeAt(0)
);

beforeEach(() =>
	vi.stubGlobal(
		'createImageBitmap',
		vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() }))
	)
);
afterEach(() => vi.unstubAllGlobals());

function makeStore(initial = 'corps') {
	const state = {
		active: { id: 'a', content: initial } as { id: string; content: string } | null,
		created: [] as string[]
	};
	const store = {
		get active() {
			return state.active;
		},
		createNew: (name: string) => {
			state.created.push(name);
			state.active = { id: 'new', content: '' };
		},
		updateContent: vi.fn((id: string, content: string) => {
			if (state.active && state.active.id === id) state.active.content = content;
		}),
		importFiles: vi.fn(async (_files: FileList | File[]) => ({
			created: [] as unknown[],
			skipped: 0,
			failed: 0
		}))
	};
	return { store, state };
}

// Create a fake DragEvent with minimal dataTransfer types and files, plus a preventDefault spy.
// Make `files` behave like a FileList with length, indexes, and iteration.
function makeDragEvent(opts: {
	types?: string[];
	files?: File[];
	relatedTarget?: EventTarget | null;
}): DragEvent {
	const arr = opts.files ?? [];
	const fileList = {
		length: arr.length,
		item: (i: number) => arr[i] ?? null,
		[Symbol.iterator]: () => arr[Symbol.iterator]()
	} as unknown as FileList;
	arr.forEach((f, i) => {
		(fileList as unknown as Record<number, File>)[i] = f;
	});
	return {
		dataTransfer: opts.types !== undefined ? { types: opts.types, files: fileList } : undefined,
		relatedTarget: 'relatedTarget' in opts ? (opts.relatedTarget ?? null) : undefined,
		preventDefault: vi.fn()
	} as unknown as DragEvent;
}

describe('appendImagesToActive', () => {
	beforeEach(() => {
		// This file checks French content. Set the locale to French because the application default is English.
		i18n.locale = 'fr';
		vi.spyOn(notify, 'error');
		notify.clear();
	});
	afterEach(() => {
		vi.restoreAllMocks();
		notify.clear();
	});

	it('inserts a valid data URI image into the active file', async () => {
		const { store } = makeStore();
		const img = new File([PNG_BYTES], 'photo.png', { type: 'image/png' });
		await appendImagesToActive([img], store);
		expect(store.updateContent).toHaveBeenCalledOnce();
		const [, content] = store.updateContent.mock.calls[0]!;
		expect(content).toContain('![photo](data:image/png;base64,');
		expect(notify.error).not.toHaveBeenCalled();
	});

	it('ignores an oversized image and notifies the user', async () => {
		const { store } = makeStore();
		const big = new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], 'huge.png', { type: 'image/png' });
		await appendImagesToActive([big], store);
		expect(store.updateContent).not.toHaveBeenCalled();
		expect(notify.error).toHaveBeenCalledOnce();
		expect(vi.mocked(notify.error).mock.calls[0]![0]).toMatch(/ignorée|Mo/);
	});

	it('inserts a valid image and reports an oversized image from one drop', async () => {
		const { store } = makeStore();
		const ok = new File([PNG_BYTES], 'ok.png', { type: 'image/png' });
		const big = new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], 'big.png', { type: 'image/png' });
		await appendImagesToActive([ok, big], store);
		expect(store.updateContent).toHaveBeenCalledOnce();
		expect(notify.error).toHaveBeenCalledOnce();
	});

	it('creates a file without an active file', async () => {
		const { store, state } = makeStore();
		state.active = null;
		const img = new File([PNG_BYTES], 'sansactif.png', { type: 'image/png' });
		await appendImagesToActive([img], store);
		expect(state.created).toContain('Images.md');
	});

	it('does nothing without images', async () => {
		const { store } = makeStore();
		await appendImagesToActive([], store);
		expect(store.updateContent).not.toHaveBeenCalled();
	});

	it('uses one newline after content that ends with a newline', async () => {
		// Content already ends with \n, so add one \n separator.
		// Remove the original content to isolate the added text.
		const orig = 'corps\n';
		const { store } = makeStore(orig);
		const img = new File([PNG_BYTES], 'p.png', { type: 'image/png' });
		await appendImagesToActive([img], store);
		const [, content] = store.updateContent.mock.calls[0]!;
		const added = content.slice(orig.length);
		// Use sep = '\n' without duplicating the final newline, then add the block.
		expect(added).toMatch(/^\n!\[p\]\(data:image\/png;base64,/);
		expect(added.startsWith('\n\n')).toBe(false);
	});

	it('uses two newlines after content without a final newline', async () => {
		const orig = 'corps';
		const { store } = makeStore(orig);
		const img = new File([PNG_BYTES], 'p.png', { type: 'image/png' });
		await appendImagesToActive([img], store);
		const [, content] = store.updateContent.mock.calls[0]!;
		const added = content.slice(orig.length);
		// Use sep = '\n\n' to add a blank line because the content did not end with \n.
		expect(added).toMatch(/^\n\n!\[p\]\(data:image\/png;base64,/);
	});

	it('separates image blocks with two newlines and adds a final newline', async () => {
		const { store } = makeStore('corps\n');
		const a = new File([PNG_BYTES], 'a.png', { type: 'image/png' });
		const b = new File([PNG_BYTES], 'b.png', { type: 'image/png' });
		await appendImagesToActive([a, b], store);
		const [, content] = store.updateContent.mock.calls[0]!;
		expect(content).toContain('![a](data:image/png;base64,');
		expect(content).toContain('![b](data:image/png;base64,');
		// Separate the two blocks with a blank line and end the document with \n.
		expect(content.split('\n\n').length).toBeGreaterThanOrEqual(2);
		expect(content.endsWith('\n')).toBe(true);
	});

	it('uses a plural notification for multiple oversized images', async () => {
		const { store } = makeStore();
		const big1 = new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], 'b1.png', { type: 'image/png' });
		const big2 = new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], 'b2.png', { type: 'image/png' });
		await appendImagesToActive([big1, big2], store);
		expect(store.updateContent).not.toHaveBeenCalled();
		expect(notify.error).toHaveBeenCalledOnce();
		// The plural message includes the image count.
		expect(vi.mocked(notify.error).mock.calls[0]![0]).toMatch(/2 images/);
	});

	it('reports an unreadable image and inserts nothing', async () => {
		const { store } = makeStore();
		// Make FileReader fail to exercise the `unreadable++` branch.
		const FakeReader = class {
			result: string | null = null;
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			readAsDataURL() {
				queueMicrotask(() => this.onerror?.());
			}
		};
		vi.stubGlobal('FileReader', FakeReader);
		const img = new File([PNG_BYTES], 'broken.png', { type: 'image/png' });
		await appendImagesToActive([img], store);
		vi.unstubAllGlobals();
		expect(store.updateContent).not.toHaveBeenCalled();
		expect(notify.error).toHaveBeenCalledOnce();
		expect(vi.mocked(notify.error).mock.calls[0]![0]).toMatch(/illisible/);
	});
});

describe('fileToDataUri', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('resolves the data URI string on load', async () => {
		const FakeReader = class {
			result: string | null = null;
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			readAsDataURL() {
				this.result = 'data:image/png;base64,AAAA';
				queueMicrotask(() => this.onload?.());
			}
		};
		vi.stubGlobal('FileReader', FakeReader);
		const out = await fileToDataUri(new File([PNG_BYTES], 'p.png', { type: 'image/png' }));
		expect(out).toBe('data:image/png;base64,AAAA');
	});

	it('resolves null when the load result is not a string', async () => {
		const FakeReader = class {
			result: ArrayBuffer | null = null;
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			readAsDataURL() {
				this.result = new ArrayBuffer(4);
				queueMicrotask(() => this.onload?.());
			}
		};
		vi.stubGlobal('FileReader', FakeReader);
		const out = await fileToDataUri(new File([PNG_BYTES], 'p.png', { type: 'image/png' }));
		expect(out).toBeNull();
	});

	it('resolves null on error', async () => {
		const FakeReader = class {
			result: string | null = null;
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			readAsDataURL() {
				queueMicrotask(() => this.onerror?.());
			}
		};
		vi.stubGlobal('FileReader', FakeReader);
		const out = await fileToDataUri(new File([PNG_BYTES], 'p.png', { type: 'image/png' }));
		expect(out).toBeNull();
	});
});

describe('isFilesDrag', () => {
	it('returns true for an operating system file drag', () => {
		expect(isFilesDrag({ dataTransfer: { types: ['Files'] } } as unknown as DragEvent)).toBe(true);
	});
	it('returns false for an internal text drag', () => {
		expect(isFilesDrag({ dataTransfer: { types: ['text/plain'] } } as unknown as DragEvent)).toBe(
			false
		);
	});
	it('returns false without dataTransfer', () => {
		expect(isFilesDrag({ dataTransfer: null } as unknown as DragEvent)).toBe(false);
	});
	it('returns false without types', () => {
		expect(isFilesDrag({ dataTransfer: {} } as unknown as DragEvent)).toBe(false);
	});
	it('returns true when Files occurs with other types', () => {
		expect(
			isFilesDrag({ dataTransfer: { types: ['text/plain', 'Files'] } } as unknown as DragEvent)
		).toBe(true);
	});
});

describe('buildDropHandlers', () => {
	beforeEach(() => {
		i18n.locale = 'fr';
		vi.spyOn(notify, 'error');
		vi.spyOn(notify, 'info');
		notify.clear();
	});
	afterEach(() => {
		vi.restoreAllMocks();
		notify.clear();
	});

	it('ignores an internal drag without Files', async () => {
		const { store } = makeStore();
		const setDragOver = vi.fn();
		const { handleDrop } = buildDropHandlers({ store, setDragOver });
		const e = makeDragEvent({ types: ['text/plain'] });
		await handleDrop(e);
		expect(e.preventDefault).not.toHaveBeenCalled();
		expect(setDragOver).not.toHaveBeenCalled();
		expect(store.importFiles).not.toHaveBeenCalled();
	});

	it('prevents an empty Files drop and resets dragOver', async () => {
		const { store } = makeStore();
		const setDragOver = vi.fn();
		const { handleDrop } = buildDropHandlers({ store, setDragOver });
		const e = makeDragEvent({ types: ['Files'], files: [] });
		await handleDrop(e);
		expect(e.preventDefault).toHaveBeenCalledOnce();
		expect(setDragOver).toHaveBeenCalledWith(false);
		expect(store.importFiles).not.toHaveBeenCalled();
		expect(notify.info).not.toHaveBeenCalled();
	});

	it('imports Markdown and inserts images from one drop', async () => {
		const { store } = makeStore();
		store.importFiles.mockResolvedValueOnce({ created: [{}], skipped: 0, failed: 0 });
		const setDragOver = vi.fn();
		const { handleDrop } = buildDropHandlers({ store, setDragOver });
		const md = new File(['# titre'], 'doc.md', { type: 'text/markdown' });
		const img = new File([PNG_BYTES], 'pic.png', { type: 'image/png' });
		const e = makeDragEvent({ types: ['Files'], files: [md, img] });
		await handleDrop(e);
		expect(setDragOver).toHaveBeenCalledWith(false);
		// Send Markdown files through importFiles.
		expect(store.importFiles).toHaveBeenCalledOnce();
		const [passed] = store.importFiles.mock.calls[0]!;
		expect((passed as File[]).map((f) => f.name)).toEqual(['doc.md']);
		// Insert the image into the active file.
		expect(store.updateContent).toHaveBeenCalledOnce();
		const [, content] = store.updateContent.mock.calls[0]!;
		expect(content).toContain('![pic](data:image/png;base64,');
		// Do not show the "no Markdown" notification because created > 0.
		expect(notify.info).not.toHaveBeenCalled();
	});

	it('reports unreadable Markdown files', async () => {
		const { store } = makeStore();
		store.importFiles.mockResolvedValueOnce({ created: [], skipped: 0, failed: 2 });
		const setDragOver = vi.fn();
		const { handleDrop } = buildDropHandlers({ store, setDragOver });
		const md = new File(['x'], 'a.md', { type: 'text/markdown' });
		const e = makeDragEvent({ types: ['Files'], files: [md] });
		await handleDrop(e);
		expect(notify.error).toHaveBeenCalledOnce();
		expect(vi.mocked(notify.error).mock.calls[0]![0]).toMatch(/illisible/);
		// With failed > 0, do not run the "no Markdown recognized" branch.
		expect(notify.info).not.toHaveBeenCalled();
	});

	it('reports a drop that contains only unrecognized files', async () => {
		const { store } = makeStore();
		const setDragOver = vi.fn();
		const { handleDrop } = buildDropHandlers({ store, setDragOver });
		// A .bin file is not an image or Markdown file because its MIME type is set and its extension differs.
		const bin = new File(['\x00\x01'], 'data.bin', { type: 'application/octet-stream' });
		const e = makeDragEvent({ types: ['Files'], files: [bin] });
		await handleDrop(e);
		expect(store.importFiles).not.toHaveBeenCalled();
		expect(store.updateContent).not.toHaveBeenCalled();
		expect(notify.info).toHaveBeenCalledOnce();
		expect(vi.mocked(notify.info).mock.calls[0]![0]).toMatch(/Aucun fichier markdown/);
	});

	it('does not report noMarkdown for an image-only drop', async () => {
		const { store } = makeStore();
		const setDragOver = vi.fn();
		const { handleDrop } = buildDropHandlers({ store, setDragOver });
		const img = new File([PNG_BYTES], 'pic.png', { type: 'image/png' });
		const e = makeDragEvent({ types: ['Files'], files: [img] });
		await handleDrop(e);
		expect(store.importFiles).not.toHaveBeenCalled();
		expect(store.updateContent).toHaveBeenCalledOnce();
		// With images.length > 0, do not show the "no Markdown" notification.
		expect(notify.info).not.toHaveBeenCalled();
	});

	it('sets dragOver for a file drag', () => {
		const { store } = makeStore();
		const setDragOver = vi.fn();
		const { handleDragOver } = buildDropHandlers({ store, setDragOver });
		const e = makeDragEvent({ types: ['Files'] });
		handleDragOver(e);
		expect(e.preventDefault).toHaveBeenCalledOnce();
		expect(setDragOver).toHaveBeenCalledWith(true);
	});

	it('does nothing for an internal drag', () => {
		const { store } = makeStore();
		const setDragOver = vi.fn();
		const { handleDragOver } = buildDropHandlers({ store, setDragOver });
		const e = makeDragEvent({ types: ['text/html'] });
		handleDragOver(e);
		expect(e.preventDefault).not.toHaveBeenCalled();
		expect(setDragOver).not.toHaveBeenCalled();
	});

	it('resets dragOver when relatedTarget is null', () => {
		const { store } = makeStore();
		const setDragOver = vi.fn();
		const { handleDragLeave } = buildDropHandlers({ store, setDragOver });
		handleDragLeave(makeDragEvent({ relatedTarget: null }));
		expect(setDragOver).toHaveBeenCalledWith(false);
	});

	it('keeps dragOver when relatedTarget exists in the document', () => {
		const { store } = makeStore();
		const setDragOver = vi.fn();
		const { handleDragLeave } = buildDropHandlers({ store, setDragOver });
		handleDragLeave(makeDragEvent({ relatedTarget: document.body }));
		expect(setDragOver).not.toHaveBeenCalled();
	});
});
