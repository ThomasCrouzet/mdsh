import * as versionHistory from './version-history';
import { ImportSession } from './import-limits';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Dexie from 'dexie';
import { db, type DraftRow } from './db';

// Export and disk wrappers delegate to pure modules. Mock them to verify the arguments and target.
// This avoids actual exports and File System Access API calls. Hoisted mocks apply to this file.
// Other suites do not use these mocks because they test in-memory orchestration.
vi.mock('./export-ops', () => ({
	exportMarkdown: vi.fn(),
	exportAllZip: vi.fn(async () => {}),
	exportHTML: vi.fn(async () => {}),
	exportPDF: vi.fn(async () => {}),
	exportSelectionZip: vi.fn(async () => {})
}));
vi.mock('./disk-sync', () => ({
	openFromDisk: vi.fn(async () => []),
	openPathsFromDesktop: vi.fn(async () => ({ files: [], processedTokens: [] })),
	openDirectoryFromDisk: vi.fn(async () => []),
	saveToDisk: vi.fn(async () => true),
	unlinkFromDisk: vi.fn(async () => {}),
	refreshBrokenLinks: vi.fn(async () => {}),
	isDiskLinkingAvailable: vi.fn(() => true)
}));

const crossTabHarness = vi.hoisted(() => ({
	onMessage: undefined as ((message: unknown) => void) | undefined,
	post: vi.fn(),
	close: vi.fn(),
	workspaceReload: vi.fn(async () => {}),
	templateReload: vi.fn(async () => {})
}));

vi.mock('./cross-tab', () => ({
	createCrossTab: vi.fn((onMessage: (message: unknown) => void) => {
		crossTabHarness.onMessage = onMessage;
		return { post: crossTabHarness.post, close: crossTabHarness.close };
	})
}));

vi.mock('./workspaces.svelte', () => ({
	workspaceStore: { reload: crossTabHarness.workspaceReload }
}));

vi.mock('./templates.svelte', () => ({
	templatesStore: { reload: crossTabHarness.templateReload }
}));

vi.mock('./fsa', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./fsa')>();
	return {
		...actual,
		isFSASupported: vi.fn(() => false),
		listDiskLinks: vi.fn(async () => []),
		getHandle: vi.fn(async () => null),
		getPathLink: vi.fn(async () => null),
		pickDirectoryFiles: vi.fn(async () => ({
			files: [],
			truncated: false,
			report: new ImportSession().publish()
		}))
	};
});

import * as exportOps from './export-ops';
import * as diskSync from './disk-sync';
import * as fsa from './fsa';
import * as trashOps from './trash';
import { filesStore } from './files.svelte';
import { notify } from './notify.svelte';
import type { CrossTabMessage } from './cross-tab';

// Test the FilesStore rune singleton with fake-indexeddb.
// The injected pure logic has separate test suites.
// Test orchestration here: create, edit, dirty state, trash, restore, close, reorder, and multi-select.
// chargement/rechargement, import, backlinks.

function draftRow(id: string, name: string, content = '', order = 0): DraftRow {
	return { id, name, content, createdAt: 1000, updatedAt: 1000, order };
}

function mdFile(name: string, content = '# x'): File {
	const f = new File([content], name, { type: 'text/markdown' });
	// jsdom's File may lack `.text()`; shim it so importFiles can read content.
	if (typeof f.text !== 'function') {
		Object.defineProperty(f, 'text', { value: async () => content });
	}
	return f;
}

function receiveCrossTab(message: CrossTabMessage): void {
	if (!crossTabHarness.onMessage) throw new Error('cross-tab non initialisé');
	crossTabHarness.onMessage(message);
}

beforeEach(async () => {
	vi.mocked(fsa.isFSASupported).mockReturnValue(false);
	vi.mocked(fsa.listDiskLinks).mockResolvedValue([]);
	vi.mocked(fsa.getHandle).mockResolvedValue(null);
	vi.mocked(fsa.getPathLink).mockResolvedValue(null);
	vi.mocked(fsa.pickDirectoryFiles).mockResolvedValue({
		files: [],
		truncated: false,
		report: new ImportSession().publish()
	});
	crossTabHarness.post.mockClear();
	crossTabHarness.workspaceReload.mockClear();
	crossTabHarness.templateReload.mockClear();
	notify.clear();
	await Promise.all([
		db.drafts.clear(),
		db.trashed.clear(),
		db.versions.clear(),
		db.workspaces.clear()
	]);
	localStorage.clear();
	// reload(false) cancels pending saves and timers, clears rune state, and reads the empty database.
	// This resets the singleton between tests.
	await filesStore.reload(false);
});

afterEach(() => {
	filesStore.selectionClear();
	notify.clear();
});

describe('createNew', () => {
	it('creates, adds, and activates a file', () => {
		const f = filesStore.createNew('a.md', '# A');
		expect(filesStore.files.map((x) => x.id)).toContain(f.id);
		expect(filesStore.activeId).toBe(f.id);
		expect(filesStore.active?.name).toBe('a.md');
		expect(f.dirty).toBe(true);
	});

	it('deduplicates names with uniqueName', () => {
		filesStore.createNew('note.md', '');
		const b = filesStore.createNew('note.md', '');
		expect(b.name).not.toBe('note.md');
		expect(b.name).toMatch(/note-2\.md|note \(2\)\.md|note-1\.md/);
	});

	it('uses a default name when none is provided', () => {
		const f = filesStore.createNew();
		expect(f.name.endsWith('.md')).toBe(true);
		expect(f.name.length).toBeGreaterThan(3);
	});
});

describe('updateContent', () => {
	it('updates content and marks it dirty', () => {
		const f = filesStore.createNew('a.md', 'old');
		filesStore.updateContent(f.id, 'new');
		expect(filesStore.files.find((x) => x.id === f.id)?.content).toBe('new');
		expect(filesStore.files.find((x) => x.id === f.id)?.dirty).toBe(true);
	});

	it('does nothing when content is identical', () => {
		const f = filesStore.createNew('a.md', 'same');
		const before = filesStore.files.find((x) => x.id === f.id)?.updatedAt;
		filesStore.updateContent(f.id, 'same');
		expect(filesStore.files.find((x) => x.id === f.id)?.updatedAt).toBe(before);
	});
});

describe('close and restore from trash', () => {
	it('closes a view without document or history loss after reload', async () => {
		const file = filesStore.createNew('conserver.md', 'texte jamais exporté');
		await filesStore.flushPendingAwait();
		await db.versions.put({
			id: 'history',
			draftId: file.id,
			name: file.name,
			content: 'avant',
			createdAt: Date.now()
		});
		filesStore.updateContent(file.id, 'dernières frappes');
		filesStore.close(file.id);
		await filesStore.flushPendingAwait();
		await filesStore.reload(false);
		expect(filesStore.files).toEqual([]);
		expect(filesStore.closedFiles.find((entry) => entry.id === file.id)?.content).toBe(
			'dernières frappes'
		);
		expect(await db.versions.get('history')).toBeDefined();
		expect(filesStore.reopen(file.id)?.content).toBe('dernières frappes');
		await filesStore.flushPendingAwait();
		expect((await db.drafts.get(file.id))?.open).toBe(true);
	});

	it('keeps a deleted document recoverable after five seconds', async () => {
		const file = filesStore.createNew('supprimer.md', 'récupérable');
		await filesStore.flushPendingAwait();
		filesStore.delete(file.id);
		await vi.waitFor(async () => expect(await db.trashed.get(file.id)).toBeDefined());
		await db.trashed.update(file.id, { trashedAt: Date.now() - 60_000 });
		await filesStore.reload(false);
		expect(filesStore.trash.find((entry) => entry.file.id === file.id)?.file.content).toBe(
			'récupérable'
		);
		expect(filesStore.restore(file.id)?.content).toBe('récupérable');
		await vi.waitFor(async () =>
			expect((await db.drafts.get(file.id))?.content).toBe('récupérable')
		);
	});

	it('removes the view on close and restores it from trash', async () => {
		const f = filesStore.createNew('a.md', '# A');
		await filesStore.flushPending();
		filesStore.delete(f.id);
		expect(filesStore.files.some((x) => x.id === f.id)).toBe(false);
		expect(filesStore.trash.some((t) => t.file.id === f.id)).toBe(true);

		const restored = filesStore.restore(f.id);
		expect(restored?.id).toBe(f.id);
		expect(filesStore.files.some((x) => x.id === f.id)).toBe(true);
		expect(filesStore.trash.some((t) => t.file.id === f.id)).toBe(false);
		// Restore is atomic, so the draft must be in the database.
		expect(await db.drafts.get(f.id)).toBeTruthy();
	});

	it('removes the view but keeps the draft with keepDB', async () => {
		const f = filesStore.createNew('a.md', '# A');
		await filesStore.flushPending();
		filesStore.close(f.id, { trash: false, keepDB: true });
		expect(filesStore.files.some((x) => x.id === f.id)).toBe(false);
		expect(await db.drafts.get(f.id)).toBeTruthy(); // draft conservé
		expect(filesStore.trash.some((t) => t.file.id === f.id)).toBe(false);
	});

	it('flushes pending edits before keepDB close', async () => {
		const f = filesStore.createNew('a.md', '# A');
		await filesStore.flushPendingAwait();
		// Edit inside the debounce window - cancel() would drop this; flush must persist it.
		filesStore.updateContent(f.id, '# Edited before workspace switch');
		filesStore.close(f.id, { trash: false, keepDB: true });
		await vi.waitFor(async () => {
			const row = await db.drafts.get(f.id);
			expect(row?.content).toBe('# Edited before workspace switch');
		});
	});

	it('keeps the draft in the library after close without trash', async () => {
		const f = filesStore.createNew('a.md', '# A');
		await filesStore.flushPending();
		filesStore.close(f.id, { trash: false });
		expect(filesStore.files.some((x) => x.id === f.id)).toBe(false);
		await filesStore.flushPendingAwait();
		expect((await db.drafts.get(f.id))?.open).toBe(false);
		expect(filesStore.closedFiles.some((file) => file.id === f.id)).toBe(true);
	});

	it('does not restore a draft deleted during a write', async () => {
		let deletedId = '';
		const put = vi.spyOn(db.drafts, 'put').mockImplementationOnce((row) => {
			deletedId = row.id;
			queueMicrotask(() => Dexie.ignoreTransaction(() => filesStore.delete(row.id)));
			return Promise.resolve(row.id) as ReturnType<typeof db.drafts.put>;
		});
		try {
			const file = filesStore.createNew('a.md', '# A');
			filesStore.flushPending();
			await vi.waitFor(() => expect(deletedId).toBe(file.id));
			await vi.waitFor(async () => {
				expect(await db.drafts.get(file.id)).toBeUndefined();
				expect(await db.trashed.get(file.id)).toBeDefined();
			});
		} finally {
			put.mockRestore();
		}
	});

	it('uses invalidate during reload and keeps the database draft', async () => {
		const f = filesStore.createNew('keep.md', '# keep');
		await filesStore.flushPendingAwait();
		expect(await db.drafts.get(f.id)).toBeTruthy();
		// Armed timer without waiting for put: invalidate must cancel without delete.
		filesStore.updateContent(f.id, '# local dirty');
		await filesStore.reload(false);
		// Row must still exist (discard reverse-delete would have removed it).
		expect(await db.drafts.get(f.id)).toBeTruthy();
	});

	it('waits for moveToTrash before restoreFromTrash', async () => {
		// Fast Undo: if restoreFromTrash runs before moveToTrash finishes, a late
		// moveToTrash would delete the restored drafts row. restore must await
		// the pending move first.
		let releaseGate: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			releaseGate = resolve;
		});
		const realMove = trashOps.moveToTrash.bind(trashOps);
		const moveSpy = vi.spyOn(trashOps, 'moveToTrash').mockImplementation(async (...args) => {
			await gate;
			return realMove(...(args as Parameters<typeof trashOps.moveToTrash>));
		});
		try {
			const f = filesStore.createNew('race.md', '# race');
			await filesStore.flushPendingAwait();
			filesStore.delete(f.id);
			expect(filesStore.trash.some((t) => t.file.id === f.id)).toBe(true);
			// Undo immediately while moveToTrash is still gated.
			filesStore.restore(f.id);
			expect(filesStore.files.some((x) => x.id === f.id)).toBe(true);
			// Release moveToTrash; restore awaits it then restoreFromTrash.
			releaseGate?.();
			await vi.waitFor(async () => {
				expect(await db.drafts.get(f.id)).toBeTruthy();
				expect(await db.trashed.get(f.id)).toBeUndefined();
			});
		} finally {
			releaseGate?.();
			moveSpy.mockRestore();
		}
	});

	it('waits for a deleted write before draft restoration', async () => {
		let restoredId = '';
		const put = vi.spyOn(db.drafts, 'put').mockImplementationOnce((row) => {
			queueMicrotask(() =>
				Dexie.ignoreTransaction(() => {
					filesStore.delete(row.id);
					filesStore.restore(row.id);
					restoredId = row.id;
				})
			);
			return Promise.resolve(row.id) as ReturnType<typeof db.drafts.put>;
		});
		try {
			const file = filesStore.createNew('undo.md', '# undo-me');
			filesStore.flushPending();
			await vi.waitFor(() => expect(restoredId).toBe(file.id));
			await vi.waitFor(async () => {
				expect(filesStore.files.some((entry) => entry.id === file.id)).toBe(true);
				expect((await db.drafts.get(file.id))?.content).toBe('# undo-me');
				expect(await db.trashed.get(file.id)).toBeUndefined();
			});
		} finally {
			put.mockRestore();
		}
	});

	it('matches tab order to workspace fileIds with reorderToIds', () => {
		const a = filesStore.createNew('a.md', 'a');
		const b = filesStore.createNew('b.md', 'b');
		const c = filesStore.createNew('c.md', 'c');
		// Simulate open order A,C,B after partial reopen (in-memory only).
		filesStore.files = [a, c, b];
		filesStore.reorderToIds([a.id, b.id, c.id]);
		expect(filesStore.files.map((f) => f.id)).toEqual([a.id, b.id, c.id]);
	});

	it('returns null when restore receives an unknown ID', () => {
		expect(filesStore.restore('ghost')).toBeNull();
	});

	it('reverts the UI when restoreFromTrash fails', async () => {
		const f = filesStore.createNew('a.md', '# A');
		await filesStore.flushPendingAwait();
		filesStore.delete(f.id);
		expect(filesStore.trash.some((t) => t.file.id === f.id)).toBe(true);

		const trashMod = await import('./trash');
		const spy = vi.spyOn(trashMod, 'restoreFromTrash').mockResolvedValue(false);
		try {
			filesStore.restore(f.id);
			// Optimistic open then rollback.
			await vi.waitFor(() => {
				expect(filesStore.files.some((x) => x.id === f.id)).toBe(false);
				expect(filesStore.trash.some((t) => t.file.id === f.id)).toBe(true);
			});
		} finally {
			spy.mockRestore();
		}
	});
});

describe('rename', () => {
	it('normalizes a rename and keeps the extension', () => {
		const f = filesStore.createNew('a.md', '');
		filesStore.rename(f.id, 'renamed');
		expect(filesStore.files.find((x) => x.id === f.id)?.name).toBe('renamed.md');
	});
});

describe('reorder', () => {
	it('reorders files in memory', () => {
		const a = filesStore.createNew('a.md', '');
		const b = filesStore.createNew('b.md', '');
		const c = filesStore.createNew('c.md', '');
		// Move a after c.
		filesStore.reorder(a.id, c.id);
		const order = filesStore.files.map((x) => x.id);
		expect(order.indexOf(a.id)).toBeGreaterThan(order.indexOf(b.id));
	});
});

describe('multiple selection', () => {
	it('toggles, extends, and clears a selection', () => {
		const a = filesStore.createNew('a.md', '');
		const b = filesStore.createNew('b.md', '');
		const c = filesStore.createNew('c.md', '');
		filesStore.selectionToggle(a.id);
		expect(filesStore.selectedIds.has(a.id)).toBe(true);
		filesStore.selectionToggle(a.id);
		expect(filesStore.selectedIds.has(a.id)).toBe(false);

		filesStore.selectionRange(a.id, c.id);
		expect(filesStore.selectedIds.has(a.id)).toBe(true);
		expect(filesStore.selectedIds.has(b.id)).toBe(true);
		expect(filesStore.selectedIds.has(c.id)).toBe(true);

		filesStore.selectionClear();
		expect(filesStore.selectedIds.size).toBe(0);
	});

	it('closes all selected files with closeSelected', async () => {
		const a = filesStore.createNew('a.md', '');
		const b = filesStore.createNew('b.md', '');
		await filesStore.flushPending();
		filesStore.selectionToggle(a.id);
		filesStore.selectionToggle(b.id);
		filesStore.closeSelected();
		expect(filesStore.files.some((x) => x.id === a.id || x.id === b.id)).toBe(false);
	});
});

describe('load', () => {
	it('loads ordered drafts and restores activeId', async () => {
		await db.drafts.bulkPut([draftRow('b', 'b.md', '', 1), draftRow('a', 'a.md', '', 0)]);
		localStorage.setItem('mdsh:activeId', 'b');
		filesStore.loaded = false;
		filesStore.files = [];
		await filesStore.load();
		expect(filesStore.files.map((f) => f.id)).toEqual(['a', 'b']);
		expect(filesStore.activeId).toBe('b');
	});

	it('activates the first file when stored activeId is missing', async () => {
		await db.drafts.put(draftRow('a', 'a.md', '', 0));
		localStorage.setItem('mdsh:activeId', 'disparu');
		filesStore.loaded = false;
		filesStore.files = [];
		await filesStore.load();
		expect(filesStore.activeId).toBe('a');
	});

	it('restores stored FSA and path links', async () => {
		await db.drafts.bulkPut([
			draftRow('fsa', 'fsa.md', '', 0),
			draftRow('path', 'path.md', '', 1),
			draftRow('none', 'none.md', '', 2)
		]);
		vi.mocked(fsa.isFSASupported).mockReturnValue(true);
		vi.mocked(fsa.listDiskLinks).mockResolvedValue([
			{ id: 'fsa', kind: 'fsa', handle: {} as FileSystemFileHandle, label: 'fsa.md' },
			{ id: 'path', kind: 'path', path: '/tmp/path.md', label: 'path.md' }
		]);

		await filesStore.reload(false);

		expect(filesStore.files.find((file) => file.id === 'fsa')?.linkedToDisk).toBe(true);
		expect(filesStore.files.find((file) => file.id === 'path')?.linkedToDisk).toBe(true);
		expect(filesStore.files.find((file) => file.id === 'none')?.linkedToDisk).toBe(false);
	});

	it('restores a recent trash entry and schedules its purge', async () => {
		await db.trashed.put({
			id: 'trashed',
			file: draftRow('trashed', 'trashed.md', '# Trash', 0),
			order: 0,
			trashedAt: Date.now()
		});

		await filesStore.reload(false);

		expect(filesStore.trash.map((entry) => entry.file.id)).toEqual(['trashed']);
	});

	it('reports an IndexedDB load error without marking the store loaded', async () => {
		const orderBy = vi.spyOn(db.drafts, 'orderBy').mockImplementationOnce(() => {
			throw new Error('IDB indisponible');
		});
		filesStore.loaded = false;

		await filesStore.load();

		expect(filesStore.loadError).toBeTruthy();
		expect(filesStore.loaded).toBe(false);
		orderBy.mockRestore();
	});
});

describe('importFiles', () => {
	it('imports Markdown files and ignores other files', async () => {
		const res = await filesStore.importFiles([
			mdFile('one.md', '# One'),
			mdFile('two.md', '# Two'),
			new File(['x'], 'image.png', { type: 'image/png' })
		]);
		expect(res.created.length).toBe(2);
		expect(res.skipped).toBe(1);
		expect(res.failed).toBe(0);
		expect(filesStore.files.length).toBe(2);
	});

	it('continues after a Markdown file becomes unreadable', async () => {
		const unreadable = {
			name: 'broken.md',
			type: 'text/markdown',
			text: vi.fn().mockRejectedValue(new Error('lecture refusée'))
		} as unknown as File;

		const result = await filesStore.importFiles([unreadable, mdFile('ok.mdx', '# OK')]);

		expect(result.failed).toBe(1);
		expect(result.created).toHaveLength(1);
		expect(result.created[0]?.name).toBe('ok.mdx.md');
	});
});

describe('cross-tab synchronization', () => {
	it('protects a failed write and keeps the remote branch during retry', async () => {
		const file = filesStore.createNew('quota.md', 'initial');
		await filesStore.flushPendingAwait();
		filesStore.updateContent(file.id, 'local non durable');
		const put = vi.spyOn(db.drafts, 'put').mockRejectedValueOnce(new Error('quota'));
		await expect(filesStore.flushPendingAwait()).rejects.toThrow();
		expect(filesStore.hasSaveError(file.id)).toBe(true);
		expect(filesStore.hasPendingSave).toBe(true);
		put.mockRestore();
		await db.drafts.put({
			...draftRow(file.id, file.name, 'branche distante'),
			updatedAt: Date.now() + 1
		});
		receiveCrossTab({ type: 'draft-written', id: file.id, updatedAt: Date.now() + 1 });
		expect(filesStore.files.find((entry) => entry.id === file.id)?.content).toBe(
			'local non durable'
		);
		await filesStore.flushPendingAwait();
		expect(filesStore.hasSaveError(file.id)).toBe(false);
		expect((await db.drafts.toArray()).map((entry) => entry.content).sort()).toEqual([
			'branche distante',
			'local non durable'
		]);
		expect(filesStore.closedFiles.some((entry) => entry.content === 'branche distante')).toBe(true);
	});

	it('reloads a remote draft without a pending local save', async () => {
		const file = filesStore.createNew('local.md', 'local');
		filesStore.flushPending();
		await vi.waitFor(() => expect(filesStore.hasPendingSave).toBe(false));
		await db.drafts.put({
			...draftRow(file.id, 'remote.md', 'remote', 0),
			updatedAt: 2000
		});

		receiveCrossTab({ type: 'draft-written', id: file.id, updatedAt: 2000 });

		await vi.waitFor(() =>
			expect(filesStore.files.find((candidate) => candidate.id === file.id)?.content).toBe('remote')
		);
		const synced = filesStore.files.find((candidate) => candidate.id === file.id);
		expect(synced?.name).toBe('remote.md');
		expect(synced?.dirty).toBe(false);
	});

	it('ignores a remote draft that is closed or missing from the database', async () => {
		receiveCrossTab({ type: 'draft-written', id: 'ghost', updatedAt: 2000 });
		const file = filesStore.createNew('missing.md', 'local');
		filesStore.flushPending();
		await vi.waitFor(() => expect(filesStore.hasPendingSave).toBe(false));
		await db.drafts.delete(file.id);

		receiveCrossTab({ type: 'draft-written', id: file.id, updatedAt: 3000 });

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(file.content).toBe('local');
	});

	it('keeps a pending local edit and offers an explicit reload', async () => {
		const file = filesStore.createNew('conflict.md', 'local');

		receiveCrossTab({ type: 'draft-written', id: file.id, updatedAt: 2000 });

		const toast = notify.toasts.at(-1);
		expect(toast?.action?.run).toBeTypeOf('function');
		toast?.action?.run();
		await vi.waitFor(() => expect(filesStore.loaded).toBe(true));
	});

	it('removes a remotely deleted draft but keeps a pending local edit', async () => {
		const clean = filesStore.createNew('clean.md', 'clean');
		filesStore.flushPending();
		await vi.waitFor(() => expect(filesStore.hasPendingSave).toBe(false));
		receiveCrossTab({ type: 'removed', id: clean.id });
		expect(filesStore.files.some((file) => file.id === clean.id)).toBe(false);

		const dirty = filesStore.createNew('dirty.md', 'dirty');
		receiveCrossTab({ type: 'removed', id: dirty.id });
		expect(filesStore.files.some((file) => file.id === dirty.id)).toBe(true);
		expect(notify.toasts.at(-1)?.action).toBeTruthy();

		receiveCrossTab({ type: 'removed', id: 'ghost' });
	});

	it('reloads after reorder and synchronizes stores after restoration', async () => {
		const reload = vi.spyOn(filesStore, 'reload').mockResolvedValue();
		receiveCrossTab({ type: 'reorder' });
		expect(reload).toHaveBeenCalledWith(false);

		receiveCrossTab({ type: 'backup-applied' });
		await vi.waitFor(() => {
			expect(crossTabHarness.workspaceReload).toHaveBeenCalledOnce();
			expect(crossTabHarness.templateReload).toHaveBeenCalledOnce();
		});
		reload.mockRestore();
	});

	it('reports a global conflict when reorder occurs during editing', () => {
		filesStore.createNew('pending.md', 'pending');
		const reload = vi.spyOn(filesStore, 'reload');

		receiveCrossTab({ type: 'reorder' });

		expect(reload).not.toHaveBeenCalled();
		expect(notify.toasts.at(-1)?.action).toBeTruthy();
		reload.mockRestore();
	});
});

describe('trash recovery', () => {
	it('reverts optimistic close when the trash transaction fails', async () => {
		const moveToTrash = vi.spyOn(trashOps, 'moveToTrash').mockResolvedValueOnce(false);
		const file = filesStore.createNew('rollback.md', '# Rollback');
		filesStore.delete(file.id);

		await vi.waitFor(() =>
			expect(filesStore.files.some((candidate) => candidate.id === file.id)).toBe(true)
		);
		expect(filesStore.trash.some((entry) => entry.file.id === file.id)).toBe(false);
		expect(moveToTrash).toHaveBeenCalledOnce();
		moveToTrash.mockRestore();
	});

	it('purges a known entry and ignores a missing ID', async () => {
		const file = filesStore.createNew('purge.md', '# Purge');
		filesStore.close(file.id, { trash: false, keepDB: true });
		filesStore.trash = [{ file, order: 0, trashedAt: Date.now() }];

		filesStore.purgeTrash(file.id);
		filesStore.purgeTrash('ghost');

		await vi.waitFor(() => expect(filesStore.trash).toEqual([]));
	});
});

describe('orchestrator guards', () => {
	it('ignores missing IDs, invalid reorder operations, and a second load', async () => {
		filesStore.close('ghost');
		filesStore.rename('ghost', 'ignored');
		filesStore.reorder('ghost', 'ghost');
		await filesStore.load();

		expect(filesStore.files).toEqual([]);
	});

	it('broadcasts an applied restoration from reload by default', async () => {
		await filesStore.reload();
		expect(crossTabHarness.post).toHaveBeenCalledWith({ type: 'backup-applied' });
	});

	it('ignores a draft removed before its row is created in flushPending', () => {
		filesStore.createNew('gone.md', '# Gone');
		filesStore.files = [];

		filesStore.flushPending();

		expect(filesStore.hasPendingSave).toBe(false);
	});
});

describe('backlinks / wiki-links', () => {
	it('resolves wiki links and calculates backlinks', () => {
		const target = filesStore.createNew('Cible.md', '# Cible');
		const source = filesStore.createNew('Source.md', 'voir [[Cible]] ici');
		const links = filesStore.wikiLinkTargets(source.id);
		expect(links.map((l) => l.toLowerCase())).toContain('cible');
		const back = filesStore.backlinks(target.id);
		expect(back.some((f) => f.id === source.id)).toBe(true);
		expect(filesStore.resolveWikiLink('Cible')).toBe(target.id);
		expect(filesStore.resolveWikiLink('Inexistant')).toBeNull();
	});
});

describe('loadDemo', () => {
	it('creates linked demo files and activates the first file', () => {
		const created = filesStore.loadDemo();
		expect(created.length).toBe(3);
		expect(filesStore.files.length).toBe(3);
		expect(filesStore.activeId).toBe(created[0]!.id);

		// The "Math and diagrams" and "Task list" files point to the first file.
		// Verify that [[Welcome to the mdsh demo]] resolves as a backlink.
		const welcome = created[0]!;
		const back = filesStore.backlinks(welcome.id);
		expect(back.length).toBe(2);
	});

	it('does not create duplicate names after two calls', () => {
		filesStore.loadDemo();
		filesStore.loadDemo();
		expect(filesStore.files.length).toBe(6);
		expect(new Set(filesStore.files.map((f) => f.name)).size).toBe(6);
	});
});

describe('replaceInAll', () => {
	it('archives the latest edits before replacement during throttling', async () => {
		const file = filesStore.createNew('a.md', 'foo initial');
		await filesStore.flushPendingAwait();
		filesStore.updateContent(file.id, 'foo juste avant');
		await filesStore.replaceInAll('foo', 'bar', {
			caseSensitive: true,
			wholeWord: false,
			useRegex: false
		});
		expect(
			(await db.versions.where('draftId').equals(file.id).toArray()).map(
				(version) => version.content
			)
		).toContain('foo juste avant');
		expect(filesStore.files.find((entry) => entry.id === file.id)?.content).toBe('bar juste avant');
	});

	it('does not change documents when the batch checkpoint fails', async () => {
		const file = filesStore.createNew('a.md', 'foo avant');
		await filesStore.flushPendingAwait();
		filesStore.updateContent(file.id, 'foo dernières frappes');
		const put = vi.spyOn(db.versions, 'put').mockRejectedValue(new Error('quota'));
		try {
			await expect(
				filesStore.replaceInAll('foo', 'bar', {
					caseSensitive: true,
					wholeWord: false,
					useRegex: false
				})
			).rejects.toThrow('quota');
			expect(filesStore.files.find((entry) => entry.id === file.id)?.content).toBe(
				'foo dernières frappes'
			);
		} finally {
			put.mockRestore();
		}
	});

	it('archives the state before version restoration', async () => {
		const file = filesStore.createNew('a.md', 'état courant');
		await filesStore.flushPendingAwait();
		await filesStore.restoreVersion(file.id, 'version ancienne');
		expect(filesStore.files.find((entry) => entry.id === file.id)?.content).toBe(
			'version ancienne'
		);
		expect(
			(await db.versions.where('draftId').equals(file.id).toArray()).map(
				(version) => version.content
			)
		).toContain('état courant');
	});

	it('replaces an occurrence in all files', async () => {
		const a = filesStore.createNew('a.md', 'foo bar foo');
		filesStore.createNew('b.md', 'no match');
		const res = await filesStore.replaceInAll('foo', 'baz', {
			caseSensitive: true,
			wholeWord: false,
			useRegex: false
		});
		expect(res.regexError).toBeNull();
		expect(res.occurrences).toBeGreaterThanOrEqual(1);
		expect(res.files).toBeGreaterThanOrEqual(1);
		expect(filesStore.files.find((x) => x.id === a.id)?.content).toContain('baz');
	});

	it('returns regexError for an invalid regular expression', async () => {
		filesStore.createNew('a.md', 'foo bar');
		const res = await filesStore.replaceInAll('(unclosed', 'x', {
			caseSensitive: false,
			wholeWord: false,
			useRegex: true
		});
		expect(res.regexError).not.toBeNull();
		expect(res.files).toBe(0);
		expect(res.occurrences).toBe(0);
		// An invalid regular expression must not change content.
		expect(filesStore.files.find((x) => x.name === 'a.md')?.content).toBe('foo bar');
	});
});

describe('export delegation to export-ops', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('delegates export to exportMarkdown with exportDeps', () => {
		const a = filesStore.createNew('a.md', '# A');
		filesStore.export(a.id);
		expect(exportOps.exportMarkdown).toHaveBeenCalledTimes(1);
		const [id, deps] = vi.mocked(exportOps.exportMarkdown).mock.calls[0]!;
		expect(id).toBe(a.id);
		// exportDeps expose getFiles + scheduleSave.
		expect(typeof deps.getFiles).toBe('function');
		expect(typeof deps.scheduleSave).toBe('function');
		expect(deps.getFiles().some((f) => f.id === a.id)).toBe(true);
		deps.scheduleSave(a.id);
	});

	it('exports the active file with exportActive', () => {
		filesStore.createNew('a.md', '# A');
		const b = filesStore.createNew('b.md', '# B');
		filesStore.setActive(b.id);
		filesStore.exportActive();
		expect(exportOps.exportMarkdown).toHaveBeenCalledTimes(1);
		expect(vi.mocked(exportOps.exportMarkdown).mock.calls[0]![0]).toBe(b.id);
	});

	it('does nothing in exportActive without an active file', () => {
		// With no open file, active is null.
		expect(filesStore.active).toBeNull();
		filesStore.exportActive();
		expect(exportOps.exportMarkdown).not.toHaveBeenCalled();
	});

	it('delegates exportAll to exportAllZip', async () => {
		filesStore.createNew('a.md', '# A');
		await filesStore.exportAll();
		expect(exportOps.exportAllZip).toHaveBeenCalledTimes(1);
		const deps = vi.mocked(exportOps.exportAllZip).mock.calls[0]![0];
		expect(typeof deps.getFiles).toBe('function');
	});

	it('delegates exportHTML with the correct ID', async () => {
		const a = filesStore.createNew('a.md', '# A');
		await filesStore.exportHTML(a.id);
		expect(exportOps.exportHTML).toHaveBeenCalledTimes(1);
		expect(vi.mocked(exportOps.exportHTML).mock.calls[0]![0]).toBe(a.id);
	});

	it('exports the active file as HTML with exportActiveHTML', async () => {
		const a = filesStore.createNew('a.md', '# A');
		await filesStore.exportActiveHTML();
		expect(exportOps.exportHTML).toHaveBeenCalledTimes(1);
		expect(vi.mocked(exportOps.exportHTML).mock.calls[0]![0]).toBe(a.id);
	});

	it('does nothing in exportActiveHTML without an active file', async () => {
		await filesStore.exportActiveHTML();
		expect(exportOps.exportHTML).not.toHaveBeenCalled();
	});

	it('delegates exportPDF with the correct ID', async () => {
		const a = filesStore.createNew('a.md', '# A');
		await filesStore.exportPDF(a.id);
		expect(exportOps.exportPDF).toHaveBeenCalledTimes(1);
		expect(vi.mocked(exportOps.exportPDF).mock.calls[0]![0]).toBe(a.id);
	});

	it('exports the active file as PDF with exportActivePDF', async () => {
		const a = filesStore.createNew('a.md', '# A');
		await filesStore.exportActivePDF();
		expect(exportOps.exportPDF).toHaveBeenCalledTimes(1);
		expect(vi.mocked(exportOps.exportPDF).mock.calls[0]![0]).toBe(a.id);
	});

	it('does nothing in exportActivePDF without an active file', async () => {
		await filesStore.exportActivePDF();
		expect(exportOps.exportPDF).not.toHaveBeenCalled();
	});

	it('delegates exportSelectedZip with the selection', async () => {
		const a = filesStore.createNew('a.md', '# A');
		const b = filesStore.createNew('b.md', '# B');
		filesStore.selectionToggle(a.id);
		filesStore.selectionToggle(b.id);
		await filesStore.exportSelectedZip();
		expect(exportOps.exportSelectionZip).toHaveBeenCalledTimes(1);
		const [selected, deps] = vi.mocked(exportOps.exportSelectionZip).mock.calls[0]!;
		expect(selected.has(a.id)).toBe(true);
		expect(selected.has(b.id)).toBe(true);
		expect(typeof deps.getFiles).toBe('function');
	});
});

describe('disk delegation to disk-sync', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('delegates openFromDisk to disk-sync with diskDeps', async () => {
		await filesStore.openFromDisk();
		expect(diskSync.openFromDisk).toHaveBeenCalledTimes(1);
		const deps = vi.mocked(diskSync.openFromDisk).mock.calls[0]![0];
		expect(typeof deps.getFile).toBe('function');
		expect(typeof deps.onCreate).toBe('function');
		expect(typeof deps.scheduleSave).toBe('function');
		const created = deps.onCreate('dep.md', 'Plain content');
		expect(filesStore.displayTitle(created.id)).toBe('dep');
		deps.onSyncName?.(created.id, 'Linked.MD');
		expect(filesStore.active?.name).toBe('Linked.MD');
		expect(filesStore.displayTitle(created.id)).toBe('Linked');
		await filesStore.flushPendingAwait();
		expect((await db.drafts.get(created.id))?.name).toBe('Linked.MD');
	});

	it('delegates paths and callbacks from openPathsFromDesktop', async () => {
		await filesStore.openPathsFromDesktop([
			{
				token: 'native-token',
				path: '/tmp/a.md',
				stat: { lastModified: 1, size: 1, revision: 'sha256:test' }
			}
		]);
		expect(diskSync.openPathsFromDesktop).toHaveBeenCalledTimes(1);
		const [grants, deps] = vi.mocked(diskSync.openPathsFromDesktop).mock.calls[0]!;
		expect(grants).toEqual([
			{
				token: 'native-token',
				path: '/tmp/a.md',
				stat: { lastModified: 1, size: 1, revision: 'sha256:test' }
			}
		]);
		const created = deps.onCreate('desktop.md', '# Desktop');
		deps.scheduleSave(created.id);
	});

	it('delegates saveToDisk with the correct ID and diskDeps', async () => {
		const a = filesStore.createNew('a.md', '# A');
		const ok = await filesStore.saveToDisk(a.id);
		expect(ok).toBe(true);
		expect(diskSync.saveToDisk).toHaveBeenCalledTimes(1);
		const [id, deps] = vi.mocked(diskSync.saveToDisk).mock.calls[0]!;
		expect(id).toBe(a.id);
		// diskDeps.getFile must find the file in the store.
		expect(deps.getFile(a.id)?.id).toBe(a.id);
	});

	it('saves the active file with saveActiveToDisk', async () => {
		filesStore.createNew('a.md', '# A');
		const b = filesStore.createNew('b.md', '# B');
		filesStore.setActive(b.id);
		const ok = await filesStore.saveActiveToDisk();
		expect(ok).toBe(true);
		expect(diskSync.saveToDisk).toHaveBeenCalledTimes(1);
		expect(vi.mocked(diskSync.saveToDisk).mock.calls[0]![0]).toBe(b.id);
	});

	it('returns false from saveActiveToDisk without an active file', async () => {
		expect(filesStore.active).toBeNull();
		const ok = await filesStore.saveActiveToDisk();
		expect(ok).toBe(false);
		expect(diskSync.saveToDisk).not.toHaveBeenCalled();
	});

	it('delegates unlinkFromDisk to disk-sync', async () => {
		const a = filesStore.createNew('a.md', '# A');
		await filesStore.unlinkFromDisk(a.id);
		expect(diskSync.unlinkFromDisk).toHaveBeenCalledTimes(1);
		expect(vi.mocked(diskSync.unlinkFromDisk).mock.calls[0]![0]).toBe(a.id);
	});

	it('delegates refreshBrokenLinks with files and an accessor', async () => {
		const a = filesStore.createNew('a.md', '# A');
		await filesStore.refreshBrokenLinks();
		expect(diskSync.refreshBrokenLinks).toHaveBeenCalledTimes(1);
		const [files, getter] = vi.mocked(diskSync.refreshBrokenLinks).mock.calls[0]!;
		expect(files.some((f) => f.id === a.id)).toBe(true);
		expect(getter(a.id)?.id).toBe(a.id);
	});
});

describe('flushPending', () => {
	it('persists pending edits immediately', async () => {
		const f = filesStore.createNew('a.md', '# A');
		filesStore.updateContent(f.id, '# A modifié');
		// The write has a 400 ms debounce, so it is not in the database yet.
		filesStore.flushPending();
		// flushPending writes synchronously through SaveQueue. Let the Dexie microtask resolve.
		await Promise.resolve();
		await new Promise((r) => setTimeout(r, 0));
		const row = await db.drafts.get(f.id);
		expect(row?.content).toBe('# A modifié');
	});
});

describe('importDirectory', () => {
	it('creates drafts from the picker and keeps truncated status', async () => {
		vi.mocked(fsa.pickDirectoryFiles).mockResolvedValue({
			files: [
				{ name: 'a.md', content: '# A' },
				{ name: 'b.txt', content: 'B' }
			],
			truncated: true,
			report: new ImportSession().publish()
		});

		const result = await filesStore.importDirectory();

		expect(result).toMatchObject({ count: 2, truncated: true });
		expect(filesStore.files.map((file) => file.name)).toEqual(['a.md', 'b.txt']);
	});
});

describe('closeMany / openMany', () => {
	it('closes multiple files and ignores unknown IDs with closeMany', async () => {
		const a = filesStore.createNew('a.md', '# A');
		const b = filesStore.createNew('b.md', '# B');
		await filesStore.flushPending();
		filesStore.closeMany([a.id, b.id, 'ghost'], { trash: false, keepDB: true });
		expect(filesStore.files.some((x) => x.id === a.id || x.id === b.id)).toBe(false);
		// keepDB : les drafts restent en base.
		expect(await db.drafts.get(a.id)).toBeTruthy();
		expect(await db.drafts.get(b.id)).toBeTruthy();
	});

	it('does nothing in closeMany when no ID matches', () => {
		const a = filesStore.createNew('a.md', '# A');
		filesStore.closeMany(['ghost1', 'ghost2']);
		expect(filesStore.files.some((x) => x.id === a.id)).toBe(true);
	});

	it('opens Dexie rows without creating them again in openMany', () => {
		const rows: DraftRow[] = [draftRow('x', 'x.md', '# X', 0), draftRow('y', 'y.md', '# Y', 1)];
		filesStore.openMany(rows);
		expect(filesStore.files.map((f) => f.id)).toEqual(expect.arrayContaining(['x', 'y']));
		const x = filesStore.files.find((f) => f.id === 'x');
		expect(x?.content).toBe('# X');
		expect(x?.dirty).toBe(false);
	});

	it('ignores already open rows by ID in openMany', () => {
		filesStore.openMany([draftRow('x', 'x.md', '# X', 0)]);
		const before = filesStore.files.length;
		filesStore.openMany([draftRow('x', 'x.md', '# X bis', 0)]);
		expect(filesStore.files.length).toBe(before);
		// Existing content must not be overwritten.
		expect(filesStore.files.find((f) => f.id === 'x')?.content).toBe('# X');
	});

	it('does nothing in openMany for an empty list', () => {
		filesStore.openMany([]);
		expect(filesStore.files.length).toBe(0);
	});

	it('restores linkedToDisk from a path link in openMany', async () => {
		vi.mocked(fsa.isFSASupported).mockReturnValue(true);
		vi.mocked(fsa.listDiskLinks).mockResolvedValue([
			{ id: 'linked', kind: 'path', path: '/tmp/linked.md', label: 'linked.md' }
		]);
		filesStore.openMany([draftRow('linked', 'linked.md', '# L', 0)]);
		await vi.waitFor(() => {
			expect(filesStore.files.find((f) => f.id === 'linked')?.linkedToDisk).toBe(true);
		});
		expect(diskSync.refreshBrokenLinks).toHaveBeenCalled();
	});

	it('does nothing in reorderToIds for zero or one tab', () => {
		const a = filesStore.createNew('a.md', 'a');
		const b = filesStore.createNew('b.md', 'b');
		const order = filesStore.files.map((f) => f.id);
		filesStore.reorderToIds([]);
		expect(filesStore.files.map((f) => f.id)).toEqual(order);
		filesStore.close(b.id, { trash: false, keepDB: true });
		filesStore.reorderToIds([a.id]);
		expect(filesStore.files.map((f) => f.id)).toEqual([a.id]);
	});
});

describe('metadata from getTags, displayTitle, and wiki links', () => {
	it('reads front matter tags and returns an empty list for an unknown ID', () => {
		const f = filesStore.createNew('a.md', '---\ntags: [un, deux]\n---\ncorps');
		expect(filesStore.getTags(f.id)).toEqual(expect.arrayContaining(['un', 'deux']));
		expect(filesStore.getTags('ghost')).toEqual([]);
	});

	it('uses front matter title before H1 and file name in displayTitle', () => {
		const fm = filesStore.createNew('a.md', '---\ntitle: Titre YAML\n---\n# Autre');
		expect(filesStore.displayTitle(fm.id)).toBe('Titre YAML');
		const noFm = filesStore.createNew('mon-doc.md', 'pas de front-matter');
		// Without front matter, use the file name without its extension.
		expect(filesStore.displayTitle(noFm.id)).toBe('mon-doc');
		// An unknown ID returns an empty string.
		expect(filesStore.displayTitle('ghost')).toBe('');
	});

	it('resolves wiki links by ID or name and returns null when unresolved', () => {
		const target = filesStore.createNew('Cible.md', '# Cible');
		expect(filesStore.resolveWikiLink(target.id)).toBe(target.id);
		expect(filesStore.resolveWikiLink('cible')).toBe(target.id);
		expect(filesStore.resolveWikiLink('   ')).toBeNull();
		expect(filesStore.resolveWikiLink('Inexistant')).toBeNull();
	});

	it('activates an existing target with openWikiLink', () => {
		const target = filesStore.createNew('Cible.md', '# Cible');
		filesStore.createNew('Autre.md', '# Autre');
		const id = filesStore.openWikiLink('Cible');
		expect(id).toBe(target.id);
		expect(filesStore.activeId).toBe(target.id);
	});

	it('creates a new file when openWikiLink cannot find the target', () => {
		const before = filesStore.files.length;
		const id = filesStore.openWikiLink('Nouvelle Note');
		expect(id).not.toBeNull();
		expect(filesStore.files.length).toBe(before + 1);
		const created = filesStore.files.find((f) => f.id === id);
		expect(created?.name).toBe('Nouvelle Note.md');
		expect(filesStore.activeId).toBe(id);
	});

	it('returns null from openWikiLink for an unresolved empty target', () => {
		const before = filesStore.files.length;
		// An empty target makes resolveWikiLink return null without creating a file.
		expect(filesStore.openWikiLink('   ')).toBeNull();
		expect(filesStore.files.length).toBe(before);
	});

	it('collects and sorts corpus tags with allTags', () => {
		filesStore.createNew('a.md', '---\ntags: [zebre, alpha]\n---\n');
		filesStore.createNew('b.md', '---\ntags: [alpha, mango]\n---\n');
		expect(filesStore.allTags).toEqual(['alpha', 'mango', 'zebre']);
	});
});

describe('bounded import orchestration', () => {
	it('imports 300 notes and rejects additional notes without reading', async () => {
		const extra = { name: 'extra.md', size: 1, arrayBuffer: vi.fn() } as unknown as File;
		const result = await filesStore.importFiles([
			...Array.from({ length: 300 }, (_, index) => mdFile(`${index}.md`, '# Note')),
			extra
		]);
		expect(result.created).toHaveLength(300);
		expect(result.failed).toBe(1);
		expect(extra.arrayBuffer).not.toHaveBeenCalled();
		expect(filesStore.lastImportReport?.issues[0]?.reason).toBe('file-count');
		expect(filesStore.importProgress).toBeNull();
	});
	it('cancels from progress and keeps the partial summary', async () => {
		const result = await filesStore.importFiles([mdFile('one.md'), mdFile('two.md')], {
			onProgress: (report) => {
				if (report.imported === 1) filesStore.cancelImport();
			}
		});
		expect(result.created).toHaveLength(1);
		expect(filesStore.lastImportReport).toMatchObject({ cancelled: true, imported: 1 });
	});
	it('respects an external signal that is already canceled', async () => {
		const controller = new AbortController();
		controller.abort();
		expect(
			(await filesStore.importFiles([mdFile('one.md')], { signal: controller.signal })).created
		).toEqual([]);
		expect(filesStore.lastImportReport?.cancelled).toBe(true);
	});
	it('requests separate approval for each large document', () => {
		const first = filesStore.createNew('large.md', 'x'.repeat(256 * 1024));
		const second = filesStore.createNew('large2.md', first.content);
		expect(filesStore.requiresRenderConfirmation(first.id)).toBe(true);
		filesStore.allowDocumentRendering(first.id);
		filesStore.allowDocumentRendering(first.id);
		expect(filesStore.requiresRenderConfirmation(first.id)).toBe(false);
		expect(filesStore.requiresRenderConfirmation(second.id)).toBe(true);
		expect(filesStore.requiresRenderConfirmation('missing')).toBe(false);
	});
	it('keeps new import progress when the previous import finishes', async () => {
		let resolveFirst!: (value: ArrayBuffer) => void;
		const first = {
			name: 'first.md',
			size: 1,
			arrayBuffer: () =>
				new Promise<ArrayBuffer>((resolve) => {
					resolveFirst = resolve;
				})
		} as File;
		const pendingFirst = filesStore.importFiles([first]);
		await vi.waitFor(() => expect(resolveFirst).toBeTypeOf('function'));
		const second = await filesStore.importFiles([mdFile('second.md')]);
		resolveFirst(new Uint8Array([65]).buffer);
		await pendingFirst;
		expect(filesStore.lastImportReport).toEqual(second.report);
		expect(filesStore.files.map((file) => file.name)).toEqual(['second.md']);
	});
});

describe('argv barrier and recovery errors', () => {
	it('acknowledges native open only after the document is durable', async () => {
		vi.mocked(diskSync.openPathsFromDesktop).mockImplementationOnce(async (_grants, deps) => ({
			files: [deps.onCreate('argv.md', 'contenu natif')],
			processedTokens: ['argv-token']
		}));
		const processed = await filesStore.openPathsFromDesktop([]);
		expect(processed).toEqual(['argv-token']);
		expect((await db.drafts.toArray())[0]?.content).toBe('contenu natif');
	});
	it('returns a persistence error before native acknowledgment', async () => {
		vi.mocked(diskSync.openPathsFromDesktop).mockImplementationOnce(async (_grants, deps) => ({
			files: [deps.onCreate('argv.md', 'contenu natif')],
			processedTokens: ['argv-token']
		}));
		const put = vi.spyOn(db.drafts, 'put').mockRejectedValue(new Error('quota'));
		try {
			await expect(filesStore.openPathsFromDesktop([])).rejects.toThrow();
			expect(filesStore.files[0]?.content).toBe('contenu natif');
			expect(filesStore.hasSaveError(filesStore.files[0]!.id)).toBe(true);
		} finally {
			put.mockRestore();
			await filesStore.flushPendingAwait();
		}
	});
	it('keeps a note in visible trash after purge failure', async () => {
		const file = filesStore.createNew('safe.md', 'safe');
		await filesStore.flushPendingAwait();
		filesStore.delete(file.id);
		await filesStore.flushPendingAwait();
		const purge = vi.spyOn(trashOps, 'purgePermanently').mockRejectedValue(new Error('storage'));
		try {
			filesStore.purgeTrash(file.id);
			await vi.waitFor(() => expect(purge).toHaveBeenCalled());
			expect(filesStore.trash.some((entry) => entry.file.id === file.id)).toBe(true);
		} finally {
			purge.mockRestore();
		}
	});
	it('ignores unchanged version restoration and a missing document', async () => {
		const file = filesStore.createNew('same.md', 'same');
		expect(await filesStore.restoreVersion('missing', 'other')).toBe(false);
		expect(await filesStore.restoreVersion(file.id, 'same')).toBe(false);
	});
	it('reactivates a closed document through a native callback without duplication', async () => {
		const file = filesStore.createNew('closed.md', 'local');
		filesStore.close(file.id);
		await filesStore.flushPendingAwait();
		vi.mocked(diskSync.openFromDisk).mockImplementationOnce(async (deps) => {
			expect(deps.getFiles?.()).toContainEqual(expect.objectContaining({ id: file.id }));
			deps.onActivate?.(file.id);
			return [file];
		});
		await filesStore.openFromDisk();
		expect(filesStore.activeId).toBe(file.id);
		expect(filesStore.closedFiles).toHaveLength(0);
		expect(filesStore.files).toHaveLength(1);
	});
});

describe('conflicts between full restoration and trash', () => {
	async function replaceCurrent() {
		const { applyBackup, BACKUP_FORMAT } = await import('./services/backup');
		const file = filesStore.createNew('same.md', 'version A');
		await filesStore.flushPendingAwait();
		await applyBackup(
			{
				format: BACKUP_FORMAT,
				schemaVersion: 1,
				exportedAt: Date.now(),
				drafts: [{ ...draftRow(file.id, file.name, 'version B'), updatedAt: Date.now() }],
				workspaces: [],
				templates: []
			},
			'replace'
		);
		await filesStore.reload();
		return file.id;
	}
	it('deletes B after full restoration without losing A or its history', async () => {
		const id = await replaceCurrent();
		filesStore.delete(id);
		expect(new Set(filesStore.trash.map((entry) => entry.file.id)).size).toBe(
			filesStore.trash.length
		);
		await filesStore.flushPendingAwait();
		const rows = await db.trashed.toArray();
		expect(rows.map((row) => row.file.content).sort()).toEqual(['version A', 'version B']);
		expect(new Set(rows.map((row) => row.id)).size).toBe(2);
		const old = rows.find((row) => row.file.content === 'version A')!;
		expect(old.file.id).toBe(old.id);
		expect(await db.versions.where('draftId').equals(old.id).count()).toBeGreaterThan(0);
		expect(filesStore.trash.map((entry) => entry.file.content).sort()).toEqual([
			'version A',
			'version B'
		]);
	});
	it.each([false, true])('restores A without conflict when B closed is %s', async (closed) => {
		const id = await replaceCurrent();
		if (closed) {
			filesStore.close(id);
			await filesStore.flushPendingAwait();
		}
		const restored = filesStore.restore(id)!;
		expect(restored.id).not.toBe(id);
		await filesStore.flushPendingAwait();
		expect((await db.drafts.get(id))?.content).toBe('version B');
		expect((await db.drafts.get(restored.id))?.content).toBe('version A');
		const all = [...filesStore.files, ...filesStore.closedFiles];
		expect(all.map((file) => file.content).sort()).toEqual(['version A', 'version B']);
		expect(new Set(all.map((file) => file.id)).size).toBe(2);
		expect(await db.versions.where('draftId').equals(restored.id).count()).toBeGreaterThan(0);
	});
	it('restores open B and trashed A after a trash copy error', async () => {
		const id = await replaceCurrent();
		const put = vi.spyOn(db.trashed, 'put').mockRejectedValueOnce(new Error('quota'));
		try {
			filesStore.delete(id);
			await filesStore.flushPendingAwait();
			expect(filesStore.files.map((file) => file.content)).toEqual(['version B']);
			expect(filesStore.trash.map((entry) => entry.file.content)).toEqual(['version A']);
			expect((await db.trashed.get(id))?.file.content).toBe('version A');
		} finally {
			put.mockRestore();
		}
	});
	it('does not create duplicate tabs for repeated references in openMany', async () => {
		const row = draftRow('duplicate', 'duplicate.md');
		filesStore.openMany([row, row, row]);
		expect(filesStore.files.map((file) => file.id)).toEqual(['duplicate']);
	});
});

describe('references replaced during operations', () => {
	it('rejects version restoration after reload replaces the current object', async () => {
		const file = filesStore.createNew('same.md', 'before');
		await filesStore.flushPendingAwait();
		let release!: (ok: boolean) => void;
		const checkpoint = vi.spyOn(versionHistory, 'createCheckpoint').mockImplementation(
			() =>
				new Promise((resolve) => {
					release = resolve;
				})
		);
		try {
			const restoring = filesStore.restoreVersion(file.id, 'old');
			filesStore.files = [{ ...filesStore.files[0]!, content: 'newly loaded' }];
			release(true);
			await expect(restoring).rejects.toThrow();
			expect(filesStore.files[0]?.content).toBe('newly loaded');
		} finally {
			checkpoint.mockRestore();
		}
	});
	it('removes a closed document deleted by another tab without restoring it', async () => {
		const file = filesStore.createNew('closed.md', 'before');
		filesStore.close(file.id);
		await filesStore.flushPendingAwait();
		await db.drafts.delete(file.id);
		receiveCrossTab({ type: 'removed', id: file.id });
		expect(filesStore.closedFiles).toHaveLength(0);
		expect(filesStore.reopen(file.id)).toBeNull();
		await filesStore.flushPendingAwait();
		expect(await db.drafts.get(file.id)).toBeUndefined();
	});
	it('also synchronizes durable content for closed documents', async () => {
		const file = filesStore.createNew('closed.md', 'before');
		filesStore.close(file.id);
		await filesStore.flushPendingAwait();
		await db.drafts.update(file.id, { content: 'remote', updatedAt: Date.now() });
		receiveCrossTab({ type: 'draft-written', id: file.id, updatedAt: Date.now() });
		await vi.waitFor(() => expect(filesStore.closedFiles[0]?.content).toBe('remote'));
	});
});

describe('editor synchronization barrier', () => {
	it('requests current Milkdown content before a durability barrier', async () => {
		const file = filesStore.createNew('wysiwyg.md', 'avant');
		await filesStore.flushPendingAwait();
		const listener = () => filesStore.updateContent(file.id, 'frappe non débouncée');
		window.addEventListener('mdsh:flush-editor', listener, { once: true });
		await filesStore.flushPendingAwait();
		expect((await db.drafts.get(file.id))?.content).toBe('frappe non débouncée');
	});
	it('also starts the synchronous pagehide barrier', async () => {
		const file = filesStore.createNew('wysiwyg.md', 'avant');
		await filesStore.flushPendingAwait();
		window.addEventListener(
			'mdsh:flush-editor',
			() => filesStore.updateContent(file.id, 'dernière frappe'),
			{ once: true }
		);
		filesStore.flushPending();
		await filesStore.flushPendingAwait();
		expect((await db.drafts.get(file.id))?.content).toBe('dernière frappe');
	});
});

describe('store recovery paths', () => {
	it('uses durable trash for an explicitly destructive close', async () => {
		const file = filesStore.createNew('trash.md', 'body');
		await filesStore.flushPendingAwait();
		filesStore.close(file.id, { trash: true });
		await filesStore.flushPendingAwait();
		expect(filesStore.trash[0]?.file.id).toBe(file.id);
		expect(await db.trashed.get(file.id)).toBeDefined();
	});
	it('deletes a closed document and ignores an unknown ID', async () => {
		const file = filesStore.createNew('closed.md', 'body');
		filesStore.close(file.id);
		await filesStore.flushPendingAwait();
		filesStore.delete('missing');
		filesStore.delete(file.id);
		await filesStore.flushPendingAwait();
		expect(filesStore.closedFiles).toEqual([]);
		expect((await db.trashed.get(file.id))?.file.content).toBe('body');
	});
	it('restores a closed view when its trash operation fails', async () => {
		const file = filesStore.createNew('closed.md', 'body');
		filesStore.close(file.id);
		await filesStore.flushPendingAwait();
		const move = vi.spyOn(trashOps, 'moveToTrash').mockResolvedValueOnce(false);
		try {
			filesStore.delete(file.id);
			await vi.waitFor(() =>
				expect(filesStore.closedFiles.map((entry) => entry.id)).toEqual([file.id])
			);
			expect(filesStore.trash).toEqual([]);
		} finally {
			move.mockRestore();
		}
	});
	it('cancels a failed restoration without removing the conflicting branch', async () => {
		const current = filesStore.createNew('current.md', 'current');
		filesStore.trash = [
			{ file: { ...current, name: 'old.md', content: 'old' }, order: 0, trashedAt: Date.now() }
		];
		const restore = vi.spyOn(trashOps, 'restoreFromTrash').mockResolvedValueOnce(false);
		try {
			const optimistic = filesStore.restore(current.id)!;
			await vi.waitFor(() =>
				expect(filesStore.trash.map((entry) => entry.file.content)).toEqual(['old'])
			);
			expect(filesStore.files.map((entry) => entry.content)).toEqual(['current']);
			expect(optimistic.id).not.toBe(current.id);
		} finally {
			restore.mockRestore();
		}
	});
	it('runs disk activation and rollback callbacks', async () => {
		const open = filesStore.createNew('open.md', 'open');
		const closed = filesStore.createNew('closed.md', 'closed');
		filesStore.close(closed.id);
		await filesStore.flushPendingAwait();
		vi.mocked(diskSync.openFromDisk).mockImplementationOnce(async (deps) => {
			deps.onActivate?.(open.id);
			deps.onActivate?.(closed.id);
			const temporary = deps.onCreate('temporary.md', 'temporary');
			deps.onImportRollback?.(temporary.id);
			return [];
		});
		await filesStore.openFromDisk();
		expect(filesStore.activeId).toBe(closed.id);
		expect(filesStore.files.map((entry) => entry.id).sort()).toEqual([closed.id, open.id].sort());
		expect(filesStore.files.some((entry) => entry.name === 'temporary.md')).toBe(false);
	});
	it('imports a desktop directory with a partial summary and applies the browser guard', async () => {
		(window as Window & { isTauri?: boolean }).isTauri = true;
		vi.mocked(diskSync.openDirectoryFromDisk).mockImplementationOnce(async (deps, options) => {
			options?.onProgress?.({
				processed: 2,
				imported: 1,
				skipped: 0,
				failed: 1,
				bytes: 4,
				cancelled: false,
				issues: [{ name: 'bad.md', reason: 'read' }]
			});
			return [deps.onCreate('good.md', 'good')];
		});
		try {
			const result = await filesStore.importDirectory();
			expect(result).toMatchObject({
				count: 1,
				truncated: true,
				report: { imported: 1, failed: 1 }
			});
			expect(filesStore.lastImportReport).toMatchObject({ imported: 1, failed: 1 });
		} finally {
			delete (window as Window & { isTauri?: boolean }).isTauri;
		}
		expect(await filesStore.importDirectoryFromDesktop()).toEqual({ count: 0, truncated: false });
	});
});

describe('defensive workspace reopen and links', () => {
	it('reopens a closed row without creating its content again', async () => {
		const file = filesStore.createNew('closed.md', 'mémoire');
		filesStore.close(file.id);
		await filesStore.flushPendingAwait();
		filesStore.openMany([{ ...draftRow(file.id, 'disk.md', 'disque'), open: false }]);
		expect(filesStore.files).toHaveLength(1);
		expect(filesStore.files[0]).toMatchObject({
			id: file.id,
			name: 'closed.md',
			content: 'mémoire'
		});
		expect(filesStore.closedFiles).toEqual([]);
	});
	it('restores an FSA handle and ignores a row without links', async () => {
		vi.mocked(fsa.isFSASupported).mockReturnValue(true);
		vi.mocked(fsa.listDiskLinks).mockResolvedValue([
			{ id: 'handle', kind: 'fsa', handle: {} as FileSystemFileHandle, label: 'handle.md' }
		]);
		filesStore.openMany([
			{ ...draftRow('handle', 'handle.md'), open: true },
			{ ...draftRow('plain', 'plain.md'), open: true }
		]);
		await vi.waitFor(() =>
			expect(filesStore.files.find((file) => file.id === 'handle')?.linkedToDisk).toBe(true)
		);
		expect(filesStore.files.find((file) => file.id === 'plain')?.linkedToDisk).toBe(false);
	});
	it('ignores missing and repeated references and keeps tabs outside the workspace', () => {
		const a = filesStore.createNew('a.md');
		const b = filesStore.createNew('b.md');
		const c = filesStore.createNew('c.md');
		filesStore.reorderToIds(['missing', b.id, b.id]);
		expect(filesStore.files.map((file) => file.id)).toEqual([b.id, a.id, c.id]);
		filesStore.reorderToIds([b.id, a.id, c.id]);
		expect(filesStore.files.map((file) => file.id)).toEqual([b.id, a.id, c.id]);
	});
	it('does not add a variant twice after backend restoration', async () => {
		const current = filesStore.createNew('current.md', 'current');
		filesStore.trash = [
			{ file: { ...current, id: 'trash', content: 'trash' }, order: 0, trashedAt: Date.now() }
		];
		const variant = { ...draftRow('variant', 'variant.md', 'variant'), open: false };
		filesStore.closedFiles = [{ ...variant, dirty: false }];
		const restore = vi
			.spyOn(trashOps, 'restoreFromTrash')
			.mockImplementationOnce(async (_id, _row, onPreserved) => {
				onPreserved?.(variant);
				return true;
			});
		try {
			filesStore.restore('trash');
			await filesStore.flushPendingAwait();
			expect(filesStore.closedFiles.filter((file) => file.id === 'variant')).toHaveLength(1);
		} finally {
			restore.mockRestore();
		}
	});
});
