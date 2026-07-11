import { describe, it, expect, vi } from 'vitest';
import { createModals, type ModalsOptions } from './modals.svelte';

function makeOpts(mode: 'wysiwyg' | 'source' | 'read' = 'wysiwyg') {
	const setActive = vi.fn();
	const goToLine = vi.fn();
	const opts = {
		getMode: vi.fn(() => mode),
		setMode: vi.fn(),
		getFilesStoreActive: vi.fn(() => null),
		getFilesStoreSetActive: vi.fn(() => setActive),
		getSourceEditorRef: vi.fn(() => ({ goToLine })),
		announceContext: vi.fn(),
		setPendingGoToHit: vi.fn(),
		setPendingOpenSearch: vi.fn()
	} satisfies ModalsOptions;
	return { opts, setActive, goToLine };
}

describe('createModals', () => {
	it('chaque open action positionne son état; les setters fonctionnent', () => {
		const { opts } = makeOpts();
		const m = createModals(opts);
		const pairs: [() => void, () => boolean][] = [
			[m.openPalette, () => m.paletteOpen],
			[m.openSearch, () => m.searchOpen],
			[m.openDiskLinks, () => m.diskLinksOpen],
			[m.openWorkspaces, () => m.workspacesOpen],
			[m.openSettings, () => m.settingsOpen],
			[m.openHistory, () => m.historyOpen],
			[m.openGraph, () => m.graphOpen],
			[m.openPresentation, () => m.presentationOpen]
		];
		for (const [open, read] of pairs) {
			expect(read()).toBe(false);
			open();
			expect(read()).toBe(true);
		}
		m.paletteOpen = false;
		expect(m.paletteOpen).toBe(false);
	});

	it("handleOpenHit bascule en source + bufferise le hit quand on n'y est pas", () => {
		const { opts, setActive } = makeOpts('wysiwyg');
		const m = createModals(opts);
		m.handleOpenHit('f1', 7, 'query');
		expect(setActive).toHaveBeenCalledWith('f1');
		expect(opts.setPendingGoToHit).toHaveBeenCalledWith({ line: 7, query: 'query' });
		expect(opts.setMode).toHaveBeenCalledWith('source');
	});

	it('handleOpenHit appelle goToLine directement si déjà en mode source', () => {
		const { opts, setActive, goToLine } = makeOpts('source');
		const m = createModals(opts);
		m.handleOpenHit('f2', 3, 'q');
		expect(setActive).toHaveBeenCalledWith('f2');
		expect(goToLine).toHaveBeenCalledWith(3, 'q');
		expect(opts.setMode).not.toHaveBeenCalled();
	});

	it('un loader mémoïsé renvoie un composant et la même promesse au 2e appel', async () => {
		const { opts } = makeOpts();
		const m = createModals(opts);
		const p1 = m.loadToc();
		const p2 = m.loadToc();
		expect(p1).toBe(p2); // mémoïsation
		const Cmp = await p1;
		expect(Cmp).toBeTruthy();
	});
});
