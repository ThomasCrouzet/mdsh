import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createModals, makeLazyLoader, type ModalsOptions } from './modals.svelte';

vi.mock('$lib/report', () => ({
	reportError: vi.fn()
}));

import { reportError } from '$lib/report';
import { t } from '$lib/i18n';

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

describe('makeLazyLoader - failure path', () => {
	beforeEach(() => {
		vi.mocked(reportError).mockClear();
	});

	it('on import() rejection: closes, reports/notifies, rethrows, and allows retry', async () => {
		const close = vi.fn();
		const err = new Error('chunk missing offline');
		const importer = vi
			.fn()
			// First call fails (stale SW / offline first open).
			.mockRejectedValueOnce(err)
			// Second call succeeds after retry.
			.mockResolvedValueOnce({ default: { name: 'FakeModal' } });

		const load = makeLazyLoader(importer, close, 'modals.labelPalette');

		await expect(load()).rejects.toThrow('chunk missing offline');
		expect(close).toHaveBeenCalledOnce();
		expect(reportError).toHaveBeenCalledOnce();
		const [scope, reportedErr, opts] = vi.mocked(reportError).mock.calls[0]!;
		expect(scope).toMatch(/lazy load/i);
		expect(reportedErr).toBe(err);
		// notifyUser is the translated failure string (not silent).
		expect(opts?.notifyUser).toBe(t('modals.loadFailed', { label: t('modals.labelPalette') }));

		// Memo was reset: a second call re-invokes the importer.
		const Cmp = await load();
		expect(Cmp).toEqual({ name: 'FakeModal' });
		expect(importer).toHaveBeenCalledTimes(2);
		// close only on the failure path.
		expect(close).toHaveBeenCalledOnce();
	});

	it('success path does not close or report', async () => {
		const close = vi.fn();
		const load = makeLazyLoader(async () => ({ default: 42 }), close, 'modals.labelSearch');
		await expect(load()).resolves.toBe(42);
		expect(close).not.toHaveBeenCalled();
		expect(reportError).not.toHaveBeenCalled();
	});
});
