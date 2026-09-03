import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildKeydownHandler, type ShortcutCallbacks } from './shortcuts.svelte';

// isDiskLinkingAvailable gates the ⌘⇧S (save to disk) shortcut.
vi.mock('$lib/disk-sync', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/disk-sync')>();
	return { ...actual, isDiskLinkingAvailable: () => true };
});

function makeCallbacks(overrides: Partial<ShortcutCallbacks> = {}) {
	const cb = {
		onNew: vi.fn(),
		onImport: vi.fn(),
		onExport: vi.fn(),
		onExportPDF: vi.fn(),
		onSaveToDisk: vi.fn(),
		getMode: vi.fn(() => 'wysiwyg' as const),
		setMode: vi.fn(),
		onToggleSidebar: vi.fn(),
		onOpenPalette: vi.fn(),
		onOpenSearch: vi.fn(),
		onOpenInFileSearch: vi.fn(),
		onOpenSettings: vi.fn(),
		onToggleFocus: vi.fn(),
		getActiveId: vi.fn(() => 'file1' as string | null),
		onClose: vi.fn(),
		...overrides
	};
	return cb as unknown as ShortcutCallbacks & typeof cb;
}

function fire(
	key: string,
	opts: { shift?: boolean; target?: Partial<HTMLElement> | null; code?: string } = {}
) {
	let prevented = false;
	const e = {
		key,
		metaKey: true,
		ctrlKey: false,
		shiftKey: opts.shift ?? false,
		code: opts.code ?? '',
		target: opts.target ?? null,
		preventDefault: () => {
			prevented = true;
		}
	};
	return { event: e as unknown as KeyboardEvent, isPrevented: () => prevented };
}

describe('buildKeydownHandler', () => {
	let cb: ReturnType<typeof makeCallbacks>;
	let handler: (e: KeyboardEvent) => void;

	beforeEach(() => {
		cb = makeCallbacks();
		handler = buildKeydownHandler(cb);
	});

	it('ignore les touches sans modificateur', () => {
		const { event } = fire('n');
		(event as { metaKey: boolean }).metaKey = false;
		handler(event);
		expect(cb.onNew).not.toHaveBeenCalled();
	});

	it('mappe chaque raccourci sur le bon callback et preventDefault', () => {
		const cases: [string, { shift?: boolean }, keyof typeof cb][] = [
			['n', {}, 'onNew'],
			['o', {}, 'onImport'],
			['s', {}, 'onExport'],
			['s', { shift: true }, 'onSaveToDisk'],
			['b', {}, 'onToggleSidebar'],
			['p', { shift: true }, 'onOpenPalette'],
			[',', {}, 'onOpenSettings'],
			['f', { shift: true }, 'onOpenSearch'],
			['f', {}, 'onOpenInFileSearch']
		];
		for (const [key, opts, fn] of cases) {
			const c = makeCallbacks();
			const h = buildKeydownHandler(c);
			const { event, isPrevented } = fire(key, opts);
			h(event);
			expect(c[fn], `${key}${opts.shift ? '+shift' : ''} -> ${fn}`).toHaveBeenCalledOnce();
			expect(isPrevented()).toBe(true);
		}
	});

	it('⌘E / ⌘R / ⌘/ pilotent setMode', () => {
		handler(fire('e').event);
		expect(cb.setMode).toHaveBeenCalledWith('wysiwyg');
		handler(fire('r').event);
		expect(cb.setMode).toHaveBeenCalledWith('read');
		handler(fire('/').event);
		expect(cb.setMode).toHaveBeenCalledWith('source'); // depuis wysiwyg
	});

	it('⌘/ sélectionne la source comme le bouton et la palette', () => {
		const c = makeCallbacks({ getMode: vi.fn(() => 'source' as const) });
		buildKeydownHandler(c)(fire('/').event);
		expect(c.setMode).toHaveBeenCalledWith('source');
	});

	it("⌘P n'est intercepté que si un fichier est actif", () => {
		handler(fire('p').event);
		expect(cb.onExportPDF).toHaveBeenCalledOnce();

		const c = makeCallbacks({ getActiveId: vi.fn(() => null) });
		const { event, isPrevented } = fire('p');
		buildKeydownHandler(c)(event);
		expect(c.onExportPDF).not.toHaveBeenCalled();
		expect(isPrevented()).toBe(false); // laisse l'impression native
	});

	it('⌘⇧. (et code Period) basculent le mode focus', () => {
		handler(fire('.', { shift: true }).event);
		expect(cb.onToggleFocus).toHaveBeenCalledOnce();
		const c = makeCallbacks();
		buildKeydownHandler(c)(fire('Dead', { shift: true, code: 'Period' }).event);
		expect(c.onToggleFocus).toHaveBeenCalledOnce();
	});

	it('⌘W ferme le fichier actif sauf dans un champ éditable', () => {
		handler(fire('w', { target: { tagName: 'DIV' } as Partial<HTMLElement> }).event);
		expect(cb.onClose).toHaveBeenCalledWith('file1');

		const c = makeCallbacks();
		buildKeydownHandler(c)(
			fire('w', { target: { tagName: 'INPUT' } as Partial<HTMLElement> }).event
		);
		expect(c.onClose).not.toHaveBeenCalled();
	});
});

describe('priorité clavier Windows et composition', () => {
	it.each([
		{ isComposing: true },
		{ defaultPrevented: true },
		{ repeat: true },
		{ altKey: true },
		{ metaKey: true }
	])('ignore une nouvelle note dans le contexte %o', (context) => {
		const cb = makeCallbacks();
		const { event } = fire('n');
		Object.assign(event, { metaKey: false, ctrlKey: true }, context);
		buildKeydownHandler(cb)(event);
		expect(cb.onNew).not.toHaveBeenCalled();
	});

	it('accepte Ctrl sous Windows lorsque le contexte est libre', () => {
		const cb = makeCallbacks();
		const { event } = fire('p', { shift: true });
		Object.assign(event, { metaKey: false, ctrlKey: true });
		buildKeydownHandler(cb)(event);
		expect(cb.onOpenPalette).toHaveBeenCalledOnce();
	});

	it('aucune commande de document ne passe derrière un dialogue', () => {
		const dialog = document.createElement('div');
		dialog.setAttribute('role', 'dialog');
		dialog.setAttribute('aria-modal', 'true');
		document.body.append(dialog);
		try {
			const cb = makeCallbacks();
			const handler = buildKeydownHandler(cb);
			for (const key of ['n', 's', 'r', 'w']) handler(fire(key).event);
			expect(cb.onNew).not.toHaveBeenCalled();
			expect(cb.onExport).not.toHaveBeenCalled();
			expect(cb.setMode).not.toHaveBeenCalled();
			expect(cb.onClose).not.toHaveBeenCalled();
		} finally {
			dialog.remove();
		}
	});

	it('laisse le gras à l’éditeur tout en autorisant sa palette', () => {
		const editor = document.createElement('div');
		editor.className = 'ProseMirror';
		Object.defineProperty(editor, 'isContentEditable', { value: true });
		const cb = makeCallbacks();
		const handler = buildKeydownHandler(cb);
		handler(fire('b', { target: editor }).event);
		handler(fire('p', { shift: true, target: editor }).event);
		expect(cb.onToggleSidebar).not.toHaveBeenCalled();
		expect(cb.onOpenPalette).toHaveBeenCalledOnce();
	});
});
