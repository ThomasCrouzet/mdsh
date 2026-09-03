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

// Construit un faux DragEvent : dataTransfer minimaliste (types + files) plus
// preventDefault espionnable. `files` mime un FileList (length + index + iterable).
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
		// Les assertions de contenu de ce fichier sont en français : on fixe la
		// locale FR (le défaut applicatif est désormais EN via la couche i18n).
		i18n.locale = 'fr';
		vi.spyOn(notify, 'error');
		notify.clear();
	});
	afterEach(() => {
		vi.restoreAllMocks();
		notify.clear();
	});

	it('insère une image valide en data URI dans le fichier actif', async () => {
		const { store } = makeStore();
		const img = new File([PNG_BYTES], 'photo.png', { type: 'image/png' });
		await appendImagesToActive([img], store);
		expect(store.updateContent).toHaveBeenCalledOnce();
		const [, content] = store.updateContent.mock.calls[0]!;
		expect(content).toContain('![photo](data:image/png;base64,');
		expect(notify.error).not.toHaveBeenCalled();
	});

	it('ignore une image trop lourde ET notifie l’utilisateur (plus de skip muet)', async () => {
		const { store } = makeStore();
		const big = new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], 'huge.png', { type: 'image/png' });
		await appendImagesToActive([big], store);
		expect(store.updateContent).not.toHaveBeenCalled();
		expect(notify.error).toHaveBeenCalledOnce();
		expect(vi.mocked(notify.error).mock.calls[0]![0]).toMatch(/ignorée|Mo/);
	});

	it('drop mixte : insère la valide, notifie pour la trop lourde', async () => {
		const { store } = makeStore();
		const ok = new File([PNG_BYTES], 'ok.png', { type: 'image/png' });
		const big = new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], 'big.png', { type: 'image/png' });
		await appendImagesToActive([ok, big], store);
		expect(store.updateContent).toHaveBeenCalledOnce();
		expect(notify.error).toHaveBeenCalledOnce();
	});

	it('crée un fichier si aucun n’est actif', async () => {
		const { store, state } = makeStore();
		state.active = null;
		const img = new File([PNG_BYTES], 'sansactif.png', { type: 'image/png' });
		await appendImagesToActive([img], store);
		expect(state.created).toContain('Images.md');
	});

	it('no-op si aucune image fournie', async () => {
		const { store } = makeStore();
		await appendImagesToActive([], store);
		expect(store.updateContent).not.toHaveBeenCalled();
	});

	it('séparateur simple \\n quand le contenu finit déjà par un saut de ligne', async () => {
		// Contenu déjà terminé par \n : le séparateur ajouté est un seul \n.
		// On enlève le contenu d'origine pour isoler exactement ce qui a été ajouté.
		const orig = 'corps\n';
		const { store } = makeStore(orig);
		const img = new File([PNG_BYTES], 'p.png', { type: 'image/png' });
		await appendImagesToActive([img], store);
		const [, content] = store.updateContent.mock.calls[0]!;
		const added = content.slice(orig.length);
		// sep = '\n' (le \n final du contenu n'est pas redoublé) puis le bloc.
		expect(added).toMatch(/^\n!\[p\]\(data:image\/png;base64,/);
		expect(added.startsWith('\n\n')).toBe(false);
	});

	it('séparateur double \\n\\n quand le contenu ne finit pas par un saut de ligne', async () => {
		const orig = 'corps';
		const { store } = makeStore(orig);
		const img = new File([PNG_BYTES], 'p.png', { type: 'image/png' });
		await appendImagesToActive([img], store);
		const [, content] = store.updateContent.mock.calls[0]!;
		const added = content.slice(orig.length);
		// sep = '\n\n' (ligne vide insérée car le contenu ne finissait pas par \n).
		expect(added).toMatch(/^\n\n!\[p\]\(data:image\/png;base64,/);
	});

	it('plusieurs blocs images séparés par \\n\\n et terminés par \\n', async () => {
		const { store } = makeStore('corps\n');
		const a = new File([PNG_BYTES], 'a.png', { type: 'image/png' });
		const b = new File([PNG_BYTES], 'b.png', { type: 'image/png' });
		await appendImagesToActive([a, b], store);
		const [, content] = store.updateContent.mock.calls[0]!;
		expect(content).toContain('![a](data:image/png;base64,');
		expect(content).toContain('![b](data:image/png;base64,');
		// Les deux blocs sont séparés par une ligne vide et le doc finit par \n.
		expect(content.split('\n\n').length).toBeGreaterThanOrEqual(2);
		expect(content.endsWith('\n')).toBe(true);
	});

	it('notifie au pluriel quand plusieurs images sont trop lourdes', async () => {
		const { store } = makeStore();
		const big1 = new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], 'b1.png', { type: 'image/png' });
		const big2 = new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], 'b2.png', { type: 'image/png' });
		await appendImagesToActive([big1, big2], store);
		expect(store.updateContent).not.toHaveBeenCalled();
		expect(notify.error).toHaveBeenCalledOnce();
		// Message pluriel : compte d'images.
		expect(vi.mocked(notify.error).mock.calls[0]![0]).toMatch(/2 images/);
	});

	it('notifie quand une image est illisible (FileReader onerror) et n’insère rien', async () => {
		const { store } = makeStore();
		// FileReader qui échoue : on force la branche `unreadable++`.
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

	it('résout la data URI sur onload (résultat string)', async () => {
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

	it('résout null si onload mais résultat non-string (ArrayBuffer)', async () => {
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

	it('résout null sur onerror', async () => {
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
	it('vrai pour un drag de fichiers OS', () => {
		expect(isFilesDrag({ dataTransfer: { types: ['Files'] } } as unknown as DragEvent)).toBe(true);
	});
	it('faux pour un drag interne (text/plain)', () => {
		expect(isFilesDrag({ dataTransfer: { types: ['text/plain'] } } as unknown as DragEvent)).toBe(
			false
		);
	});
	it('faux si dataTransfer est absent', () => {
		expect(isFilesDrag({ dataTransfer: null } as unknown as DragEvent)).toBe(false);
	});
	it('faux si types est absent', () => {
		expect(isFilesDrag({ dataTransfer: {} } as unknown as DragEvent)).toBe(false);
	});
	it('vrai quand "Files" coexiste avec d’autres types', () => {
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

	it('handleDrop : ignore un drag interne (pas de "Files")', async () => {
		const { store } = makeStore();
		const setDragOver = vi.fn();
		const { handleDrop } = buildDropHandlers({ store, setDragOver });
		const e = makeDragEvent({ types: ['text/plain'] });
		await handleDrop(e);
		expect(e.preventDefault).not.toHaveBeenCalled();
		expect(setDragOver).not.toHaveBeenCalled();
		expect(store.importFiles).not.toHaveBeenCalled();
	});

	it('handleDrop : Files mais liste vide -> preventDefault + reset dragOver, rien d’autre', async () => {
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

	it('handleDrop : drop mixte markdown + image (importe + insère)', async () => {
		const { store } = makeStore();
		store.importFiles.mockResolvedValueOnce({ created: [{}], skipped: 0, failed: 0 });
		const setDragOver = vi.fn();
		const { handleDrop } = buildDropHandlers({ store, setDragOver });
		const md = new File(['# titre'], 'doc.md', { type: 'text/markdown' });
		const img = new File([PNG_BYTES], 'pic.png', { type: 'image/png' });
		const e = makeDragEvent({ types: ['Files'], files: [md, img] });
		await handleDrop(e);
		expect(setDragOver).toHaveBeenCalledWith(false);
		// Les markdowns passent par importFiles.
		expect(store.importFiles).toHaveBeenCalledOnce();
		const [passed] = store.importFiles.mock.calls[0]!;
		expect((passed as File[]).map((f) => f.name)).toEqual(['doc.md']);
		// L’image est insérée dans le fichier actif.
		expect(store.updateContent).toHaveBeenCalledOnce();
		const [, content] = store.updateContent.mock.calls[0]!;
		expect(content).toContain('![pic](data:image/png;base64,');
		// Pas de notif "aucun markdown" car created > 0.
		expect(notify.info).not.toHaveBeenCalled();
	});

	it('handleDrop : markdowns illisibles -> notifie markdownUnreadable', async () => {
		const { store } = makeStore();
		store.importFiles.mockResolvedValueOnce({ created: [], skipped: 0, failed: 2 });
		const setDragOver = vi.fn();
		const { handleDrop } = buildDropHandlers({ store, setDragOver });
		const md = new File(['x'], 'a.md', { type: 'text/markdown' });
		const e = makeDragEvent({ types: ['Files'], files: [md] });
		await handleDrop(e);
		expect(notify.error).toHaveBeenCalledOnce();
		expect(vi.mocked(notify.error).mock.calls[0]![0]).toMatch(/illisible/);
		// failed > 0 : la branche "aucun markdown reconnu" ne se déclenche pas.
		expect(notify.info).not.toHaveBeenCalled();
	});

	it('handleDrop : que des fichiers non reconnus -> notifie noMarkdown', async () => {
		const { store } = makeStore();
		const setDragOver = vi.fn();
		const { handleDrop } = buildDropHandlers({ store, setDragOver });
		// .bin n’est ni image ni markdown (type non vide, extension non md/txt).
		const bin = new File(['\x00\x01'], 'data.bin', { type: 'application/octet-stream' });
		const e = makeDragEvent({ types: ['Files'], files: [bin] });
		await handleDrop(e);
		expect(store.importFiles).not.toHaveBeenCalled();
		expect(store.updateContent).not.toHaveBeenCalled();
		expect(notify.info).toHaveBeenCalledOnce();
		expect(vi.mocked(notify.info).mock.calls[0]![0]).toMatch(/Aucun fichier markdown/);
	});

	it('handleDrop : que des images -> pas de notif noMarkdown', async () => {
		const { store } = makeStore();
		const setDragOver = vi.fn();
		const { handleDrop } = buildDropHandlers({ store, setDragOver });
		const img = new File([PNG_BYTES], 'pic.png', { type: 'image/png' });
		const e = makeDragEvent({ types: ['Files'], files: [img] });
		await handleDrop(e);
		expect(store.importFiles).not.toHaveBeenCalled();
		expect(store.updateContent).toHaveBeenCalledOnce();
		// images.length > 0 : pas de notif "aucun markdown".
		expect(notify.info).not.toHaveBeenCalled();
	});

	it('handleDragOver : active dragOver sur un drag de fichiers', () => {
		const { store } = makeStore();
		const setDragOver = vi.fn();
		const { handleDragOver } = buildDropHandlers({ store, setDragOver });
		const e = makeDragEvent({ types: ['Files'] });
		handleDragOver(e);
		expect(e.preventDefault).toHaveBeenCalledOnce();
		expect(setDragOver).toHaveBeenCalledWith(true);
	});

	it('handleDragOver : no-op sur un drag interne', () => {
		const { store } = makeStore();
		const setDragOver = vi.fn();
		const { handleDragOver } = buildDropHandlers({ store, setDragOver });
		const e = makeDragEvent({ types: ['text/html'] });
		handleDragOver(e);
		expect(e.preventDefault).not.toHaveBeenCalled();
		expect(setDragOver).not.toHaveBeenCalled();
	});

	it('handleDragLeave : reset dragOver quand relatedTarget est null', () => {
		const { store } = makeStore();
		const setDragOver = vi.fn();
		const { handleDragLeave } = buildDropHandlers({ store, setDragOver });
		handleDragLeave(makeDragEvent({ relatedTarget: null }));
		expect(setDragOver).toHaveBeenCalledWith(false);
	});

	it('handleDragLeave : no-op quand relatedTarget existe (drag interne au document)', () => {
		const { store } = makeStore();
		const setDragOver = vi.fn();
		const { handleDragLeave } = buildDropHandlers({ store, setDragOver });
		handleDragLeave(makeDragEvent({ relatedTarget: document.body }));
		expect(setDragOver).not.toHaveBeenCalled();
	});
});
