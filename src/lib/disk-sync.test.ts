import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { notify } from './notify.svelte';
import { promptStore } from './prompt.svelte';
import type { FileItem } from './types';

// Mock all FSA operations to test disk synchronization, FileItem flags,
// notifications, mtime guards, and per-file error handling.
// jsdom does not provide the native File System Access API.
vi.mock('./fsa', () => ({
	isFSASupported: vi.fn(() => true),
	getFsaLink: vi.fn(),
	getHandle: vi.fn(),
	getPathLink: vi.fn(),
	getPathLinkWithEpoch: vi.fn(),
	requestPermission: vi.fn(),
	pickSaveTarget: vi.fn(),
	revisionForFile: vi.fn(),
	revisionForText: vi.fn(),
	saveHandle: vi.fn(),
	savePathLink: vi.fn(),
	writeHandle: vi.fn(),
	deleteHandle: vi.fn(),
	checkHandle: vi.fn(),
	pickAndOpen: vi.fn()
}));

vi.mock('./desktop', () => ({
	isDesktop: vi.fn(() => false)
}));

vi.mock('./db', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./db')>();
	return { ...actual, getDiskLinkEpoch: vi.fn(async () => 'epoch') };
});

vi.mock('./disk-tauri', () => ({
	tauriPickDirectoryAndOpen: vi.fn(async () => ({ files: [], failed: 0 })),
	tauriPickAndOpen: vi.fn(async () => ({ files: [], failed: 0 })),
	tauriPickSaveTarget: vi.fn(async () => null),
	tauriWritePath: vi.fn(async () => ({
		lastModified: 1,
		size: 1,
		revision: 'sha256:written'
	})),
	tauriReadMeta: vi.fn(async () => null),
	tauriCheckPath: vi.fn(async () => 'ok'),
	tauriOpenNativeGrants: vi.fn(async () => ({ files: [], failed: 0 }))
}));

import * as fsa from './fsa';
import * as desktop from './desktop';
import * as diskTauri from './disk-tauri';
import * as database from './db';
import {
	openFromDisk,
	openDirectoryFromDisk,
	openPathsFromDesktop,
	saveToDisk,
	unlinkFromDisk,
	refreshBrokenLinks,
	isDiskLinkingAvailable,
	type DiskSyncDeps
} from './disk-sync';

function makeFile(over: Partial<FileItem> = {}): FileItem {
	return {
		id: 'a',
		name: 'note.md',
		content: 'contenu',
		createdAt: 0,
		updatedAt: 0,
		dirty: true,
		linkedToDisk: false,
		...over
	};
}

const handle = {} as unknown as FileSystemFileHandle;

// jsdom does not implement File.prototype.text. Create a file-like object with
// text, lastModified, and size values. openFromDisk uses only these properties.
function fakeFile(
	name: string,
	content: string,
	over: { lastModified?: number; size?: number } = {}
): File {
	return {
		name,
		lastModified: over.lastModified ?? 0,
		size: over.size ?? content.length,
		arrayBuffer: async () => new TextEncoder().encode(content).buffer
	} as unknown as File;
}

function testDeps(store: FileItem[]): DiskSyncDeps {
	return {
		getFile: (id) => store.find((file) => file.id === id),
		onCreate: (name, content) => {
			const item = makeFile({ id: `test-${name}`, name, content });
			store.push(item);
			return item;
		},
		scheduleSave: vi.fn()
	};
}

beforeEach(() => {
	notify.clear();
	vi.clearAllMocks();
	// Hide expected reportError output.
	vi.spyOn(console, 'error').mockImplementation(() => {});
	// Use FSA support without desktop support by default.
	vi.mocked(fsa.isFSASupported).mockReturnValue(true);
	vi.mocked(desktop.isDesktop).mockReturnValue(false);
	vi.mocked(fsa.getFsaLink).mockResolvedValue(null);
	vi.mocked(fsa.getPathLink).mockResolvedValue(null);
	vi.mocked(fsa.getPathLinkWithEpoch).mockImplementation(async (id) => {
		const record = await fsa.getPathLink(id);
		return record ? { record, epoch: 'epoch' } : null;
	});
	vi.mocked(fsa.revisionForFile).mockResolvedValue('sha256:disk');
	vi.mocked(fsa.revisionForText).mockResolvedValue('sha256:local');
	vi.mocked(database.getDiskLinkEpoch).mockResolvedValue('epoch');
});

describe('openFromDisk', () => {
	function depsFor(store: FileItem[]): DiskSyncDeps {
		return {
			getFile: (id) => store.find((f) => f.id === id),
			onCreate: (name, content) => {
				const item = makeFile({ id: `id-${name}`, name, content, dirty: false });
				store.push(item);
				return item;
			},
			scheduleSave: vi.fn()
		};
	}

	it('returns an empty list when FSA is unavailable', async () => {
		vi.mocked(fsa.isFSASupported).mockReturnValue(false);
		const created = await openFromDisk(depsFor([]));
		expect(created).toEqual([]);
		expect(fsa.pickAndOpen).not.toHaveBeenCalled();
	});

	it('returns an empty list after picker cancellation', async () => {
		vi.mocked(fsa.pickAndOpen).mockResolvedValue([]);
		const created = await openFromDisk(depsFor([]));
		expect(created).toEqual([]);
	});

	it('opens each file, marks its disk link, and persists its handle', async () => {
		const fileA = fakeFile('a.md', '# A', { lastModified: 1000 });
		const fileB = fakeFile('b.md', '# B', { lastModified: 2000 });
		const hA = { tag: 'A' } as unknown as FileSystemFileHandle;
		const hB = { tag: 'B' } as unknown as FileSystemFileHandle;
		vi.mocked(fsa.pickAndOpen).mockResolvedValue([
			{ handle: hA, file: fileA },
			{ handle: hB, file: fileB }
		]);
		vi.mocked(fsa.saveHandle).mockResolvedValue(undefined);

		const store: FileItem[] = [];
		const created = await openFromDisk(depsFor(store));

		expect(created).toHaveLength(2);
		expect(created.map((f) => f.name)).toEqual(['a.md', 'b.md']);
		expect(created.every((f) => f.linkedToDisk === true)).toBe(true);
		expect(created[0]!.diskLastModified).toBe(1000);
		expect(created[0]!.diskSize).toBe(fileA.size);
		// Persist one handle per file.
		expect(fsa.saveHandle).toHaveBeenCalledTimes(2);
		expect(fsa.saveHandle).toHaveBeenCalledWith('id-a.md', hA, 'sha256:disk', 'epoch');
		// Do not show a partial toast when all files succeed.
		expect(notify.toasts).toHaveLength(0);
	});

	it('keeps the byte revision when UTF-8 decoding removes a BOM', async () => {
		const source = '\uFEFF# Title';
		const file = fakeFile('bom.md', source, { size: new TextEncoder().encode(source).byteLength });
		const handle = { tag: 'BOM' } as unknown as FileSystemFileHandle;
		vi.mocked(fsa.pickAndOpen).mockResolvedValue([{ handle, file }]);
		vi.mocked(fsa.revisionForFile).mockResolvedValue('sha256:bytes-with-bom');

		const created = await openFromDisk(depsFor([]));

		expect(created[0]?.content).toBe('# Title');
		expect(fsa.revisionForFile).toHaveBeenCalledWith(file);
		expect(fsa.revisionForText).not.toHaveBeenCalled();
		expect(fsa.saveHandle).toHaveBeenCalledWith(
			'id-bom.md',
			handle,
			'sha256:bytes-with-bom',
			'epoch'
		);
	});

	it('continues after an unreadable file and shows a partial info toast', async () => {
		const good = fakeFile('good.md', 'ok');
		// Reject `.text()` to simulate a content read failure.
		const bad = {
			name: 'bad.md',
			lastModified: 0,
			size: 0,
			arrayBuffer: vi.fn().mockRejectedValue(new Error('illisible'))
		} as unknown as File;
		vi.mocked(fsa.pickAndOpen).mockResolvedValue([
			{ handle, file: good },
			{ handle, file: bad }
		]);
		vi.mocked(fsa.saveHandle).mockResolvedValue(undefined);

		const store: FileItem[] = [];
		const created = await openFromDisk(depsFor(store));

		expect(created).toHaveLength(1);
		expect(created[0]!.name).toBe('good.md');
		// reportError receives the failed file.
		expect(console.error).toHaveBeenCalled();
		// Show the partial result in an info toast.
		expect(notify.toasts.some((t) => t.level === 'info')).toBe(true);
	});

	it('counts a handle persistence failure as a skipped file', async () => {
		const f = fakeFile('x.md', 'ok');
		vi.mocked(fsa.pickAndOpen).mockResolvedValue([{ handle, file: f }]);
		vi.mocked(fsa.saveHandle).mockRejectedValue(new Error('IDB plein'));

		const store: FileItem[] = [];
		const created = await openFromDisk(depsFor(store));

		// onCreate runs, but saveHandle failure excludes the file from the result.
		// Do not show a partial toast because no file succeeded.
		expect(created).toHaveLength(0);
		expect(console.error).toHaveBeenCalled();
		expect(notify.toasts.some((t) => t.level === 'info')).toBe(false);
	});
});

describe('saveToDisk', () => {
	let file: FileItem;
	let scheduleSave: Mock<(id: string) => void>;
	let deps: DiskSyncDeps;

	beforeEach(() => {
		file = makeFile();
		scheduleSave = vi.fn();
		deps = { getFile: () => file, onCreate: () => file, scheduleSave };
	});

	it('returns false when FSA is unavailable', async () => {
		vi.mocked(fsa.isFSASupported).mockReturnValue(false);
		expect(await saveToDisk('a', deps)).toBe(false);
	});

	it('returns false when the file is missing', async () => {
		const missing: DiskSyncDeps = { ...deps, getFile: () => undefined };
		expect(await saveToDisk('a', missing)).toBe(false);
	});

	it('writes with an approved handle, updates flags, and schedules a save', async () => {
		const written = new File(['contenu'], 'note.md');
		Object.defineProperty(written, 'lastModified', { value: 5555, configurable: true });
		const handleWithFile = {
			getFile: vi.fn().mockResolvedValue(written)
		} as unknown as FileSystemFileHandle;
		vi.mocked(fsa.getFsaLink).mockResolvedValue({
			handle: handleWithFile,
			revision: 'sha256:disk',
			epoch: 'epoch'
		});
		vi.mocked(fsa.requestPermission).mockResolvedValue(true);
		vi.mocked(fsa.writeHandle).mockResolvedValue(undefined);

		const ok = await saveToDisk('a', deps);

		expect(ok).toBe(true);
		expect(file.linkedToDisk).toBe(true);
		expect(file.brokenLink).toBe(false);
		expect(file.dirty).toBe(false);
		// Refresh the overwrite baseline after the write.
		expect(file.diskLastModified).toBe(5555);
		expect(file.diskSize).toBe(written.size);
		expect(scheduleSave).toHaveBeenCalledWith('a');
		expect(notify.toasts.some((t) => t.level === 'success')).toBe(true);
	});

	it('returns false without a toast when handle permission is denied', async () => {
		vi.mocked(fsa.getFsaLink).mockResolvedValue({
			handle,
			revision: 'sha256:disk',
			epoch: 'epoch'
		});
		vi.mocked(fsa.requestPermission).mockResolvedValue(false);
		expect(await saveToDisk('a', deps)).toBe(false);
		expect(notify.toasts).toHaveLength(0);
		expect(fsa.writeHandle).not.toHaveBeenCalled();
	});

	it('returns false and marks the link broken after a write failure', async () => {
		vi.mocked(fsa.getFsaLink).mockResolvedValue({
			handle,
			revision: 'sha256:disk',
			epoch: 'epoch'
		});
		vi.mocked(fsa.requestPermission).mockResolvedValue(true);
		vi.mocked(fsa.writeHandle).mockRejectedValue(new Error('disk fail'));
		const ok = await saveToDisk('a', deps);
		expect(ok).toBe(false);
		expect(file.brokenLink).toBe(true);
		expect(notify.toasts.some((t) => t.level === 'error')).toBe(true);
		expect(scheduleSave).not.toHaveBeenCalled();
	});

	it('opens a picker, persists the new handle, and writes', async () => {
		const picked = { tag: 'picked' } as unknown as FileSystemFileHandle;
		const written = new File(['contenu'], 'note.md');
		Object.defineProperty(picked, 'getFile', {
			value: vi.fn().mockResolvedValue(written),
			configurable: true
		});
		vi.mocked(fsa.getFsaLink).mockResolvedValue(null);
		vi.mocked(fsa.pickSaveTarget).mockResolvedValue(picked);
		vi.mocked(fsa.saveHandle).mockResolvedValue(undefined);
		vi.mocked(fsa.writeHandle).mockResolvedValue(undefined);

		const ok = await saveToDisk('a', deps);

		expect(ok).toBe(true);
		expect(fsa.pickSaveTarget).toHaveBeenCalledWith('note.md');
		expect(fsa.saveHandle).toHaveBeenCalledWith('a', picked, 'sha256:local', 'epoch');
		expect(file.linkedToDisk).toBe(true);
	});

	it('does not persist a new handle when the write fails', async () => {
		const picked = { tag: 'picked' } as unknown as FileSystemFileHandle;
		vi.mocked(fsa.pickSaveTarget).mockResolvedValue(picked);
		vi.mocked(fsa.writeHandle).mockRejectedValue(new Error('disk fail'));

		expect(await saveToDisk('a', deps)).toBe(false);
		expect(fsa.saveHandle).not.toHaveBeenCalled();
	});

	it('writes one content snapshot and keeps a later edit dirty', async () => {
		const picked = { tag: 'picked' } as unknown as FileSystemFileHandle;
		let releaseHash!: (revision: string) => void;
		vi.mocked(fsa.pickSaveTarget).mockResolvedValue(picked);
		vi.mocked(fsa.revisionForText).mockImplementation(
			() => new Promise<string>((resolve) => (releaseHash = resolve))
		);
		vi.mocked(fsa.writeHandle).mockResolvedValue(undefined);

		const saving = saveToDisk('a', deps);
		await vi.waitFor(() => expect(fsa.revisionForText).toHaveBeenCalledWith('contenu'));
		file.content = 'later edit';
		releaseHash('sha256:snapshot');

		expect(await saving).toBe(true);
		expect(fsa.writeHandle).toHaveBeenCalledWith(picked, 'contenu');
		expect(fsa.saveHandle).toHaveBeenCalledWith('a', picked, 'sha256:snapshot', 'epoch');
		expect(file.dirty).toBe(true);
	});

	it('persists the epoch captured before a replacement restore race', async () => {
		const picked = { tag: 'picked' } as unknown as FileSystemFileHandle;
		vi.mocked(database.getDiskLinkEpoch).mockResolvedValueOnce('before-restore');
		vi.mocked(fsa.pickSaveTarget).mockResolvedValue(picked);
		vi.mocked(fsa.writeHandle).mockResolvedValue(undefined);

		expect(await saveToDisk('a', deps)).toBe(true);
		expect(fsa.saveHandle).toHaveBeenCalledWith('a', picked, 'sha256:local', 'before-restore');
		expect(database.getDiskLinkEpoch).toHaveBeenCalledTimes(1);
	});

	it('returns false without a write after picker cancellation', async () => {
		vi.mocked(fsa.getFsaLink).mockResolvedValue(null);
		vi.mocked(fsa.pickSaveTarget).mockResolvedValue(null);
		expect(await saveToDisk('a', deps)).toBe(false);
		expect(fsa.writeHandle).not.toHaveBeenCalled();
		expect(fsa.saveHandle).not.toHaveBeenCalled();
	});

	it('clears the baseline when a read after write fails', async () => {
		const getFile = vi.fn().mockRejectedValue(new Error('relecture KO'));
		const h = { getFile } as unknown as FileSystemFileHandle;
		vi.mocked(fsa.getFsaLink).mockResolvedValue({
			handle: h,
			revision: 'sha256:disk',
			epoch: 'epoch'
		});
		vi.mocked(fsa.requestPermission).mockResolvedValue(true);
		vi.mocked(fsa.writeHandle).mockResolvedValue(undefined);
		const ok = await saveToDisk('a', deps);
		expect(ok).toBe(false);
		expect(fsa.writeHandle).not.toHaveBeenCalled();
		expect(file.brokenLink).toBe(true);
	});

	describe('overwrite guard for mtime conflicts (§C2)', () => {
		beforeEach(() => {
			// Use an existing link with a known disk baseline.
			file = makeFile({ linkedToDisk: true, diskLastModified: 1000, diskSize: 7 });
			deps = { getFile: () => file, onCreate: () => file, scheduleSave };
		});

		it('writes after confirmation when disk content differs', async () => {
			const onDisk = new File(['autre contenu disque'], 'note.md');
			Object.defineProperty(onDisk, 'lastModified', { value: 9999, configurable: true });
			const writtenAfter = new File(['contenu'], 'note.md');
			Object.defineProperty(writtenAfter, 'lastModified', { value: 12345, configurable: true });
			const getFile = vi
				.fn()
				.mockResolvedValueOnce(onDisk) // check anti-écrasement
				.mockResolvedValueOnce(writtenAfter); // rafraîchissement baseline
			const h = { getFile } as unknown as FileSystemFileHandle;
			vi.mocked(fsa.getFsaLink).mockResolvedValue({
				handle: h,
				revision: 'sha256:before',
				epoch: 'epoch'
			});
			vi.mocked(fsa.revisionForFile).mockResolvedValue('sha256:changed');
			vi.mocked(fsa.requestPermission).mockResolvedValue(true);
			vi.mocked(fsa.writeHandle).mockResolvedValue(undefined);
			const confirmSpy = vi.spyOn(promptStore, 'confirm').mockResolvedValue(true);

			const ok = await saveToDisk('a', deps);

			expect(confirmSpy).toHaveBeenCalled();
			expect(ok).toBe(true);
			expect(fsa.writeHandle).toHaveBeenCalled();
			expect(file.diskLastModified).toBe(12345);
			confirmSpy.mockRestore();
		});

		it('returns false without a write after conflict rejection', async () => {
			const onDisk = new File(['autre'], 'note.md');
			Object.defineProperty(onDisk, 'lastModified', { value: 9999, configurable: true });
			const h = { getFile: vi.fn().mockResolvedValue(onDisk) } as unknown as FileSystemFileHandle;
			vi.mocked(fsa.getFsaLink).mockResolvedValue({
				handle: h,
				revision: 'sha256:before',
				epoch: 'epoch'
			});
			vi.mocked(fsa.revisionForFile).mockResolvedValue('sha256:changed');
			vi.mocked(fsa.requestPermission).mockResolvedValue(true);
			const confirmSpy = vi.spyOn(promptStore, 'confirm').mockResolvedValue(false);

			const ok = await saveToDisk('a', deps);

			expect(ok).toBe(false);
			expect(fsa.writeHandle).not.toHaveBeenCalled();
			expect(notify.toasts.some((t) => t.level === 'info')).toBe(true);
			confirmSpy.mockRestore();
		});

		it('requests confirmation for a size-only difference', async () => {
			// The same mtime with a different size is a conflict.
			const onDisk = new File(['taille differente'], 'note.md');
			Object.defineProperty(onDisk, 'lastModified', { value: 1000, configurable: true });
			const h = { getFile: vi.fn().mockResolvedValue(onDisk) } as unknown as FileSystemFileHandle;
			vi.mocked(fsa.getFsaLink).mockResolvedValue({
				handle: h,
				revision: 'sha256:before',
				epoch: 'epoch'
			});
			vi.mocked(fsa.revisionForFile).mockResolvedValue('sha256:changed');
			vi.mocked(fsa.requestPermission).mockResolvedValue(true);
			const confirmSpy = vi.spyOn(promptStore, 'confirm').mockResolvedValue(false);

			await saveToDisk('a', deps);
			expect(confirmSpy).toHaveBeenCalled();
			confirmSpy.mockRestore();
		});

		it('writes unchanged disk content without confirmation', async () => {
			const onDisk = new File(['1234567'], 'note.md'); // 7 octets, mtime 1000 = baseline
			Object.defineProperty(onDisk, 'lastModified', { value: 1000, configurable: true });
			const writtenAfter = new File(['contenu'], 'note.md');
			Object.defineProperty(writtenAfter, 'lastModified', { value: 2000, configurable: true });
			const getFile = vi.fn().mockResolvedValueOnce(onDisk).mockResolvedValueOnce(writtenAfter);
			const h = { getFile } as unknown as FileSystemFileHandle;
			vi.mocked(fsa.getFsaLink).mockResolvedValue({
				handle: h,
				revision: 'sha256:disk',
				epoch: 'epoch'
			});
			vi.mocked(fsa.requestPermission).mockResolvedValue(true);
			vi.mocked(fsa.writeHandle).mockResolvedValue(undefined);
			const confirmSpy = vi.spyOn(promptStore, 'confirm');

			const ok = await saveToDisk('a', deps);

			expect(ok).toBe(true);
			expect(confirmSpy).not.toHaveBeenCalled();
			confirmSpy.mockRestore();
		});

		it('requires confirmation when a legacy link has no stored revision', async () => {
			const onDisk = new File(['contenu'], 'note.md');
			const h = { getFile: vi.fn().mockResolvedValue(onDisk) } as unknown as FileSystemFileHandle;
			vi.mocked(fsa.getFsaLink).mockResolvedValue({ handle: h, revision: null, epoch: 'epoch' });
			const confirmSpy = vi.spyOn(promptStore, 'confirm').mockResolvedValue(false);

			expect(await saveToDisk('a', deps)).toBe(false);
			expect(confirmSpy).toHaveBeenCalled();
			expect(fsa.writeHandle).not.toHaveBeenCalled();
			confirmSpy.mockRestore();
		});

		it('blocks the write when the revision check fails', async () => {
			const writtenAfter = new File(['contenu'], 'note.md');
			Object.defineProperty(writtenAfter, 'lastModified', { value: 3000, configurable: true });
			const getFile = vi
				.fn()
				.mockRejectedValueOnce(new Error('lecture check KO')) // check anti-écrasement
				.mockResolvedValueOnce(writtenAfter); // rafraîchissement baseline post-write
			const h = { getFile } as unknown as FileSystemFileHandle;
			vi.mocked(fsa.getFsaLink).mockResolvedValue({
				handle: h,
				revision: 'sha256:disk',
				epoch: 'epoch'
			});
			vi.mocked(fsa.requestPermission).mockResolvedValue(true);
			vi.mocked(fsa.writeHandle).mockResolvedValue(undefined);
			const confirmSpy = vi.spyOn(promptStore, 'confirm');

			const ok = await saveToDisk('a', deps);

			// A failed preflight read cannot prove that the file is unchanged.
			expect(confirmSpy).not.toHaveBeenCalled();
			expect(console.error).toHaveBeenCalled();
			expect(ok).toBe(false);
			expect(fsa.writeHandle).not.toHaveBeenCalled();
			confirmSpy.mockRestore();
		});
	});
});

describe('unlinkFromDisk', () => {
	it('deletes the handle, unlinks the file, and schedules a save', async () => {
		const file = makeFile({ linkedToDisk: true, brokenLink: true });
		const scheduleSave = vi.fn();
		const deps: DiskSyncDeps = { getFile: () => file, onCreate: () => file, scheduleSave };
		vi.mocked(fsa.deleteHandle).mockResolvedValue(undefined);

		await unlinkFromDisk('a', deps);

		expect(fsa.deleteHandle).toHaveBeenCalledWith('a');
		expect(file.linkedToDisk).toBe(false);
		// Intentional unlink must clear the broken-link badge.
		expect(file.brokenLink).toBe(false);
		expect(scheduleSave).toHaveBeenCalledWith('a');
	});

	it('deletes an orphan handle when the store file is missing', async () => {
		const scheduleSave = vi.fn();
		const deps: DiskSyncDeps = {
			getFile: () => undefined,
			onCreate: () => makeFile(),
			scheduleSave
		};
		vi.mocked(fsa.deleteHandle).mockResolvedValue(undefined);

		await unlinkFromDisk('orphan', deps);

		// Delete the IndexedDB handle first for the DiskLinksPanel contract.
		expect(fsa.deleteHandle).toHaveBeenCalledWith('orphan');
		// Do not schedule a save without a FileItem.
		expect(scheduleSave).not.toHaveBeenCalled();
	});
});

describe('isDiskLinkingAvailable', () => {
	it('returns true when FSA is available', () => {
		vi.mocked(fsa.isFSASupported).mockReturnValue(true);
		vi.mocked(desktop.isDesktop).mockReturnValue(false);
		expect(isDiskLinkingAvailable()).toBe(true);
	});

	it('returns true in the desktop shell without FSA', () => {
		vi.mocked(fsa.isFSASupported).mockReturnValue(false);
		vi.mocked(desktop.isDesktop).mockReturnValue(true);
		expect(isDiskLinkingAvailable()).toBe(true);
	});

	it('returns false without FSA or desktop', () => {
		vi.mocked(fsa.isFSASupported).mockReturnValue(false);
		vi.mocked(desktop.isDesktop).mockReturnValue(false);
		expect(isDiskLinkingAvailable()).toBe(false);
	});
});

describe('openFromDisk desktop capability backend', () => {
	function depsFor(store: FileItem[]): DiskSyncDeps {
		return {
			getFile: (id) => store.find((f) => f.id === id),
			onCreate: (name, content) => {
				const item = makeFile({ id: `id-${name}`, name, content, dirty: false });
				store.push(item);
				return item;
			},
			scheduleSave: vi.fn()
		};
	}

	it('uses the Tauri backend and persists a path link', async () => {
		vi.mocked(desktop.isDesktop).mockReturnValue(true);
		vi.mocked(fsa.isFSASupported).mockReturnValue(false);
		vi.mocked(diskTauri.tauriPickAndOpen).mockResolvedValue({
			files: [
				{
					name: 'note.md',
					content: '# hi',
					path: '/tmp/note.md',
					lastModified: 42,
					size: 4,
					revision: 'sha256:open',
					link: { kind: 'path', path: '/tmp/note.md' }
				}
			],
			failed: 0
		});
		const store: FileItem[] = [];
		const created = await openFromDisk(depsFor(store));
		expect(created).toHaveLength(1);
		expect(created[0]!.linkedToDisk).toBe(true);
		expect(created[0]!.diskLastModified).toBe(42);
		expect(created[0]!.diskRevision).toBe('sha256:open');
		expect(fsa.savePathLink).toHaveBeenCalledWith(
			'id-note.md',
			{
				kind: 'path',
				path: '/tmp/note.md'
			},
			'epoch'
		);
		expect(fsa.pickAndOpen).not.toHaveBeenCalled();
	});

	it('openPathsFromDesktop consumes native argv capabilities', async () => {
		vi.mocked(desktop.isDesktop).mockReturnValue(true);
		vi.mocked(diskTauri.tauriOpenNativeGrants).mockResolvedValue({
			files: [
				{
					token: 'argv-token',
					name: 'from-argv.md',
					content: 'x',
					path: '/Users/me/from-argv.md',
					lastModified: 1,
					size: 1,
					revision: 'sha256:argv',
					link: { kind: 'path', path: '/Users/me/from-argv.md' }
				}
			],
			failed: 0
		});
		const store: FileItem[] = [];
		const nativeGrant = {
			token: 'argv-token',
			path: '/Users/me/from-argv.md',
			stat: { lastModified: 1, size: 1, revision: 'sha256:argv' }
		};
		const created = await openPathsFromDesktop([nativeGrant], depsFor(store));
		expect(created.files).toHaveLength(1);
		expect(created.processedTokens).toEqual(['argv-token']);
		expect(diskTauri.tauriOpenNativeGrants).toHaveBeenCalledWith([nativeGrant], {});
		expect(fsa.savePathLink).toHaveBeenCalled();
	});
});

describe('saveToDisk desktop capability backend', () => {
	function desktopDeps(file: FileItem) {
		const scheduleSave = vi.fn();
		const onSyncName = vi.fn((id: string, name: string) => {
			if (id === file.id) file.name = name;
		});
		const deps: DiskSyncDeps = {
			getFile: () => file,
			onCreate: () => file,
			onSyncName,
			scheduleSave
		};
		vi.mocked(desktop.isDesktop).mockReturnValue(true);
		vi.mocked(fsa.isFSASupported).mockReturnValue(false);
		return { deps, onSyncName, scheduleSave };
	}

	it('writes with the recorded revision and stores the returned revision', async () => {
		const file = makeFile({
			content: 'new',
			linkedToDisk: true,
			diskLastModified: 10,
			diskSize: 3,
			diskRevision: 'sha256:before'
		});
		const { deps, scheduleSave } = desktopDeps(file);
		vi.mocked(fsa.getPathLink).mockResolvedValue({ kind: 'path', path: '/tmp/note.md' });
		vi.mocked(diskTauri.tauriWritePath).mockResolvedValue({
			lastModified: 99,
			size: 3,
			revision: 'sha256:after'
		});

		const ok = await saveToDisk('a', deps);
		expect(ok).toBe(true);
		expect(diskTauri.tauriWritePath).toHaveBeenCalledWith(
			'/tmp/note.md',
			'new',
			'sha256:before',
			false
		);
		expect(file.dirty).toBe(false);
		expect(file.diskLastModified).toBe(99);
		expect(file.diskRevision).toBe('sha256:after');
		expect(scheduleSave).toHaveBeenCalledWith('a');
	});

	it('returns false when the native picker is canceled', async () => {
		const file = makeFile();
		const { deps, onSyncName } = desktopDeps(file);
		vi.mocked(fsa.getPathLink).mockResolvedValue(null);
		vi.mocked(diskTauri.tauriPickSaveTarget).mockResolvedValue(null);

		expect(await saveToDisk('a', deps)).toBe(false);
		expect(diskTauri.tauriWritePath).not.toHaveBeenCalled();
		expect(onSyncName).not.toHaveBeenCalled();
	});

	it('persists a newly selected target and writes with its native revision', async () => {
		const file = makeFile({ name: 'Untitled.md' });
		const { deps, onSyncName, scheduleSave } = desktopDeps(file);
		const pathLink = { kind: 'path' as const, path: '/tmp/Chosen.MDX' };
		vi.mocked(fsa.getPathLink).mockResolvedValue(null);
		vi.mocked(diskTauri.tauriPickSaveTarget).mockResolvedValue(pathLink);
		vi.mocked(diskTauri.tauriReadMeta).mockResolvedValue({
			lastModified: 10,
			size: 3,
			revision: 'sha256:selected'
		});
		vi.mocked(diskTauri.tauriWritePath).mockResolvedValue({
			lastModified: 20,
			size: 7,
			revision: 'sha256:written'
		});

		expect(await saveToDisk('a', deps)).toBe(true);
		expect(fsa.savePathLink).toHaveBeenCalledWith('a', pathLink, 'epoch');
		expect(file.linkedToDisk).toBe(true);
		expect(diskTauri.tauriWritePath).toHaveBeenCalledWith(
			'/tmp/Chosen.MDX',
			'contenu',
			'sha256:selected',
			false
		);
		expect(file.diskRevision).toBe('sha256:written');
		expect(file.name).toBe('Chosen.MDX');
		expect(onSyncName).toHaveBeenCalledWith('a', 'Chosen.MDX');
		expect(notify.toasts.find((toast) => toast.level === 'success')?.message).toContain(
			'Chosen.MDX'
		);
		expect(scheduleSave).toHaveBeenCalledWith('a');
	});

	it('reuses the persisted target after the first native save', async () => {
		const file = makeFile({ name: 'Untitled.md' });
		const { deps, onSyncName } = desktopDeps(file);
		const pathLink = { kind: 'path' as const, path: '/tmp/chosen.md' };
		vi.mocked(fsa.getPathLink).mockResolvedValueOnce(null).mockResolvedValue(pathLink);
		vi.mocked(diskTauri.tauriPickSaveTarget).mockResolvedValue(pathLink);
		vi.mocked(diskTauri.tauriWritePath).mockResolvedValue({
			lastModified: 20,
			size: 7,
			revision: 'sha256:written'
		});

		expect(await saveToDisk('a', deps)).toBe(true);
		expect(await saveToDisk('a', deps)).toBe(true);

		expect(diskTauri.tauriPickSaveTarget).toHaveBeenCalledOnce();
		expect(diskTauri.tauriWritePath).toHaveBeenCalledTimes(2);
		expect(onSyncName).toHaveBeenCalledOnce();
		expect(file.name).toBe('chosen.md');
	});

	it('does not persist a new path when the native write fails', async () => {
		const file = makeFile();
		const { deps, onSyncName } = desktopDeps(file);
		vi.mocked(fsa.getPathLink).mockResolvedValue(null);
		vi.mocked(diskTauri.tauriPickSaveTarget).mockResolvedValue({
			kind: 'path',
			path: '/tmp/new.md'
		});
		vi.mocked(diskTauri.tauriWritePath).mockRejectedValue(new Error('disk full'));

		expect(await saveToDisk('a', deps)).toBe(false);
		expect(fsa.savePathLink).not.toHaveBeenCalled();
		expect(onSyncName).not.toHaveBeenCalled();
		expect(file.name).toBe('note.md');
	});

	it('keeps a concurrent draft rename after a successful native write', async () => {
		const file = makeFile({ name: 'Untitled.md' });
		const { deps, onSyncName } = desktopDeps(file);
		const pathLink = { kind: 'path' as const, path: '/tmp/chosen.md' };
		vi.mocked(fsa.getPathLink).mockResolvedValue(null);
		vi.mocked(diskTauri.tauriPickSaveTarget).mockResolvedValue(pathLink);
		vi.mocked(diskTauri.tauriWritePath).mockImplementation(async () => {
			file.name = 'Manual.md';
			return { lastModified: 20, size: 7, revision: 'sha256:written' };
		});

		expect(await saveToDisk('a', deps)).toBe(true);
		expect(file.name).toBe('Manual.md');
		expect(onSyncName).not.toHaveBeenCalled();
		expect(notify.toasts.find((toast) => toast.level === 'success')?.message).toContain(
			'chosen.md'
		);
	});

	it('keeps an edit made during a native write dirty', async () => {
		const file = makeFile({ content: 'snapshot' });
		const { deps } = desktopDeps(file);
		let releaseWrite!: (value: { lastModified: number; size: number; revision: string }) => void;
		vi.mocked(fsa.getPathLink).mockResolvedValue({ kind: 'path', path: '/tmp/note.md' });
		vi.mocked(diskTauri.tauriWritePath).mockImplementation(
			() =>
				new Promise((resolve) => {
					releaseWrite = resolve;
				})
		);

		const saving = saveToDisk('a', deps);
		await vi.waitFor(() =>
			expect(diskTauri.tauriWritePath).toHaveBeenCalledWith('/tmp/note.md', 'snapshot', null, false)
		);
		file.content = 'later edit';
		releaseWrite({ lastModified: 2, size: 8, revision: 'sha256:snapshot' });

		expect(await saving).toBe(true);
		expect(file.dirty).toBe(true);
	});

	it('cancels when the native final revision check reports a conflict', async () => {
		const file = makeFile({ diskRevision: 'sha256:before' });
		const { deps } = desktopDeps(file);
		vi.mocked(fsa.getPathLink).mockResolvedValue({ kind: 'path', path: '/tmp/note.md' });
		vi.mocked(diskTauri.tauriWritePath).mockRejectedValue(
			new Error('disk conflict: target changed since it was opened')
		);
		const confirmSpy = vi.spyOn(promptStore, 'confirm').mockResolvedValue(false);

		expect(await saveToDisk('a', deps)).toBe(false);
		expect(diskTauri.tauriWritePath).toHaveBeenCalledOnce();
		expect(notify.toasts.some((toast) => toast.level === 'info')).toBe(true);
		confirmSpy.mockRestore();
	});

	it('retries a confirmed conflict with the explicit force flag', async () => {
		const file = makeFile({ diskRevision: 'sha256:before' });
		const { deps } = desktopDeps(file);
		vi.mocked(fsa.getPathLink).mockResolvedValue({ kind: 'path', path: '/tmp/note.md' });
		vi.mocked(diskTauri.tauriWritePath)
			.mockRejectedValueOnce(new Error('disk conflict: target changed since it was opened'))
			.mockResolvedValueOnce({
				lastModified: 30,
				size: 7,
				revision: 'sha256:forced'
			});
		const confirmSpy = vi.spyOn(promptStore, 'confirm').mockResolvedValue(true);

		expect(await saveToDisk('a', deps)).toBe(true);
		expect(diskTauri.tauriWritePath).toHaveBeenLastCalledWith(
			'/tmp/note.md',
			'contenu',
			'sha256:before',
			true
		);
		expect(file.diskRevision).toBe('sha256:forced');
		confirmSpy.mockRestore();
	});

	it('reports a native write error and marks the link broken', async () => {
		const file = makeFile();
		const { deps, scheduleSave } = desktopDeps(file);
		vi.mocked(fsa.getPathLink).mockResolvedValue({ kind: 'path', path: '/tmp/note.md' });
		vi.mocked(diskTauri.tauriWritePath).mockRejectedValue(new Error('disk full'));

		expect(await saveToDisk('a', deps)).toBe(false);
		expect(file.brokenLink).toBe(true);
		expect(notify.toasts.some((toast) => toast.level === 'error')).toBe(true);
		expect(scheduleSave).not.toHaveBeenCalled();
	});

	it('requires a fresh native picker after the session capability expires', async () => {
		const file = makeFile({ diskRevision: 'sha256:old' });
		const { deps, onSyncName } = desktopDeps(file);
		vi.mocked(fsa.getPathLink).mockResolvedValue({ kind: 'path', path: '/tmp/note.md' });
		vi.mocked(diskTauri.tauriWritePath)
			.mockRejectedValueOnce(new Error('Disk capability expired. Choose the file again.'))
			.mockResolvedValueOnce({
				lastModified: 50,
				size: 7,
				revision: 'sha256:reauthorized'
			});
		vi.mocked(diskTauri.tauriPickSaveTarget).mockResolvedValue({
			kind: 'path',
			path: '/tmp/reauthorized.md'
		});
		vi.mocked(diskTauri.tauriReadMeta).mockResolvedValue({
			lastModified: 40,
			size: 3,
			revision: 'sha256:selected'
		});

		expect(await saveToDisk('a', deps)).toBe(true);
		expect(fsa.savePathLink).toHaveBeenCalledWith(
			'a',
			{
				kind: 'path',
				path: '/tmp/reauthorized.md'
			},
			'epoch'
		);
		expect(file.diskRevision).toBe('sha256:reauthorized');
		expect(file.name).toBe('reauthorized.md');
		expect(onSyncName).toHaveBeenCalledWith('a', 'reauthorized.md');
		expect(notify.toasts.find((toast) => toast.level === 'success')?.message).toContain(
			'reauthorized.md'
		);
	});

	it('keeps the old name when a retargeted path cannot be persisted', async () => {
		const file = makeFile({ name: 'note.md', diskRevision: 'sha256:old' });
		const { deps, onSyncName } = desktopDeps(file);
		vi.mocked(fsa.getPathLink).mockResolvedValue({ kind: 'path', path: '/tmp/note.md' });
		vi.mocked(diskTauri.tauriWritePath)
			.mockRejectedValueOnce(new Error('Disk capability expired. Choose the file again.'))
			.mockResolvedValueOnce({
				lastModified: 50,
				size: 7,
				revision: 'sha256:reauthorized'
			});
		vi.mocked(diskTauri.tauriPickSaveTarget).mockResolvedValue({
			kind: 'path',
			path: '/tmp/new-target.md'
		});
		vi.mocked(diskTauri.tauriReadMeta).mockResolvedValue({
			lastModified: 40,
			size: 3,
			revision: 'sha256:selected'
		});
		vi.mocked(fsa.savePathLink).mockRejectedValueOnce(new Error('IndexedDB'));

		expect(await saveToDisk('a', deps)).toBe(true);
		expect(file.linkedToDisk).toBe(true);
		expect(file.name).toBe('note.md');
		expect(onSyncName).not.toHaveBeenCalled();
		expect(notify.toasts.some((toast) => toast.level === 'error')).toBe(true);
	});
});

describe('refreshBrokenLinks', () => {
	it('does nothing without FSA outside desktop', async () => {
		vi.mocked(fsa.isFSASupported).mockReturnValue(false);
		vi.mocked(desktop.isDesktop).mockReturnValue(false);
		const files = [makeFile({ id: 'f1', linkedToDisk: true })];
		await refreshBrokenLinks(files, () => files[0]);
		// Do not call getHandle or checkHandle.
		expect(fsa.getHandle).not.toHaveBeenCalled();
		expect(fsa.checkHandle).not.toHaveBeenCalled();
	});

	it('sets brokenLink when checkHandle returns broken', async () => {
		const f = makeFile({ id: 'f1', linkedToDisk: true });
		vi.mocked(fsa.getHandle).mockResolvedValue(handle);
		vi.mocked(fsa.checkHandle).mockResolvedValue('broken');
		await refreshBrokenLinks([f], (id) => (id === 'f1' ? f : undefined));
		expect(f.brokenLink).toBe(true);
		expect(f.linkedToDisk).toBe(true); // handle présent → on garde le lien
	});

	it('sets brokenLink and clears linkedToDisk for a missing handle', async () => {
		const f = makeFile({ id: 'f1', linkedToDisk: true });
		vi.mocked(fsa.getHandle).mockResolvedValue(null);
		await refreshBrokenLinks([f], (id) => (id === 'f1' ? f : undefined));
		expect(f.brokenLink).toBe(true);
		expect(f.linkedToDisk).toBe(false);
		// Do not call checkHandle without a handle.
		expect(fsa.checkHandle).not.toHaveBeenCalled();
	});

	it('clears brokenLink and keeps linkedToDisk for a valid link', async () => {
		const f = makeFile({ id: 'f1', linkedToDisk: true, brokenLink: true });
		vi.mocked(fsa.getHandle).mockResolvedValue(handle);
		vi.mocked(fsa.checkHandle).mockResolvedValue('ok');
		await refreshBrokenLinks([f], (id) => (id === 'f1' ? f : undefined));
		expect(f.brokenLink).toBe(false);
		expect(f.linkedToDisk).toBe(true);
	});

	it('ignores files that are not linked to disk', async () => {
		const f = makeFile({ id: 'f1', linkedToDisk: false });
		await refreshBrokenLinks([f], () => f);
		expect(fsa.getHandle).not.toHaveBeenCalled();
	});

	it('skips an update when FileItem is missing from the store', async () => {
		const f = makeFile({ id: 'f1', linkedToDisk: true });
		vi.mocked(fsa.getHandle).mockResolvedValue(handle);
		vi.mocked(fsa.checkHandle).mockResolvedValue('broken');
		// getFileMutable cannot find the file after concurrent deletion.
		await expect(refreshBrokenLinks([f], () => undefined)).resolves.toBeUndefined();
		// Do not change the original object when lookup returns undefined.
		expect(f.brokenLink).toBeUndefined();
	});
});

describe('guarded native imports', () => {
	const opened = {
		name: 'note.md',
		content: 'disk',
		path: '/tmp/note.md',
		lastModified: 42,
		size: 4,
		revision: 'new-disk-revision',
		link: { kind: 'path' as const, path: '/tmp/note.md' }
	};
	it('reactivates an existing dirty draft without branch or revision changes', async () => {
		vi.mocked(desktop.isDesktop).mockReturnValue(true);
		vi.mocked(diskTauri.tauriPickAndOpen).mockResolvedValue({ files: [opened], failed: 0 });
		const file = makeFile({
			name: 'Untitled.md',
			content: 'local unsaved',
			dirty: true,
			diskRevision: 'old-revision'
		});
		vi.mocked(fsa.getPathLink).mockResolvedValue({ kind: 'path', path: opened.path });
		const onCreate = vi.fn();
		const onActivate = vi.fn();
		const onSyncName = vi.fn((id: string, name: string) => {
			if (id === file.id) file.name = name;
		});
		const result = await openFromDisk({
			getFile: () => file,
			getFiles: () => [file],
			onCreate,
			onActivate,
			onSyncName,
			scheduleSave: vi.fn()
		});
		expect(result).toEqual([file]);
		expect(onActivate).toHaveBeenCalledWith(file.id);
		expect(onSyncName).toHaveBeenCalledWith(file.id, 'note.md');
		expect(onCreate).not.toHaveBeenCalled();
		expect(file).toMatchObject({
			name: 'note.md',
			content: 'local unsaved',
			dirty: true,
			diskRevision: 'old-revision'
		});
	});

	it('restores a missing native baseline only when disk content is unchanged', async () => {
		vi.mocked(desktop.isDesktop).mockReturnValue(true);
		vi.mocked(diskTauri.tauriPickAndOpen).mockResolvedValue({ files: [opened], failed: 0 });
		const file = makeFile({ content: opened.content, dirty: false, diskRevision: undefined });
		vi.mocked(fsa.getPathLink).mockResolvedValue({ kind: 'path', path: opened.path });
		const scheduleSave = vi.fn();

		await openFromDisk({
			getFile: () => file,
			getFiles: () => [file],
			onCreate: vi.fn(),
			onActivate: vi.fn(),
			scheduleSave
		});

		expect(file).toMatchObject({
			diskLastModified: opened.lastModified,
			diskSize: opened.size,
			diskRevision: opened.revision
		});
		expect(scheduleSave).toHaveBeenCalledWith(file.id);
	});
	it('imports a native directory and keeps backend failures in the summary', async () => {
		vi.mocked(desktop.isDesktop).mockReturnValue(true);
		vi.mocked(diskTauri.tauriPickDirectoryAndOpen).mockResolvedValue({
			files: [opened],
			failed: 1
		});
		const onProgress = vi.fn();
		const result = await openDirectoryFromDisk(
			{
				getFile: () => undefined,
				onCreate: (name, content) => makeFile({ name, content }),
				scheduleSave: vi.fn()
			},
			{ onProgress }
		);
		expect(result).toHaveLength(1);
		expect(onProgress).toHaveBeenLastCalledWith(
			expect.objectContaining({ imported: 1, failed: 1 })
		);
	});
	it('rejects false Markdown and stops creation after cancellation', async () => {
		vi.mocked(desktop.isDesktop).mockReturnValue(true);
		const onCreate = vi.fn();
		const deps = { getFile: () => undefined, onCreate, scheduleSave: vi.fn() };
		vi.mocked(diskTauri.tauriPickAndOpen).mockResolvedValue({
			files: [{ ...opened, content: '\0' }],
			failed: 0
		});
		expect(await openFromDisk(deps)).toEqual([]);
		const controller = new AbortController();
		controller.abort();
		expect(await openFromDisk(deps, { signal: controller.signal })).toEqual([]);
		expect(onCreate).not.toHaveBeenCalled();
	});
	it('does not start a native picker in a browser', async () => {
		expect(
			await openDirectoryFromDisk({
				getFile: () => undefined,
				onCreate: vi.fn(),
				scheduleSave: vi.fn()
			})
		).toEqual([]);
		expect(diskTauri.tauriPickDirectoryAndOpen).not.toHaveBeenCalled();
	});
});

describe('native capability acknowledgment', () => {
	it('returns only created or deduplicated tokens with persistent links', async () => {
		vi.mocked(desktop.isDesktop).mockReturnValue(true);
		vi.mocked(diskTauri.tauriOpenNativeGrants).mockResolvedValue({
			files: [
				{
					token: 'good-token',
					name: 'good.md',
					content: 'ok',
					path: '/tmp/good.md',
					lastModified: 1,
					size: 2,
					revision: 'r1',
					link: { kind: 'path', path: '/tmp/good.md' }
				},
				{
					token: 'binary-token',
					name: 'binary.md',
					content: '\0',
					path: '/tmp/binary.md',
					lastModified: 1,
					size: 1,
					revision: 'r2',
					link: { kind: 'path', path: '/tmp/binary.md' }
				}
			],
			failed: 1
		});
		const result = await openPathsFromDesktop(
			[
				{ token: 'good-token', path: '/tmp/good.md', stat: null },
				{ token: 'binary-token', path: '/tmp/binary.md', stat: null },
				{ token: 'read-failed-token', path: '/tmp/read-failed.md', stat: null }
			],
			testDeps([])
		);
		expect(result.files.map((file) => file.name)).toEqual(['good.md']);
		expect(result.processedTokens).toEqual(['good-token']);
	});
	it('reverts in-memory creation when token link persistence fails', async () => {
		vi.mocked(desktop.isDesktop).mockReturnValue(true);
		vi.mocked(diskTauri.tauriOpenNativeGrants).mockResolvedValue({
			files: [
				{
					token: 'failed-token',
					name: 'failed.md',
					content: 'ok',
					path: '/tmp/failed.md',
					lastModified: 1,
					size: 2,
					revision: 'r1',
					link: { kind: 'path', path: '/tmp/failed.md' }
				}
			],
			failed: 0
		});
		vi.mocked(fsa.savePathLink).mockRejectedValueOnce(new Error('IndexedDB'));
		const store: FileItem[] = [];
		const deps = testDeps(store);
		deps.onImportRollback = (id) =>
			store.splice(
				store.findIndex((file) => file.id === id),
				1
			);
		const result = await openPathsFromDesktop(
			[{ token: 'failed-token', path: '/tmp/failed.md', stat: null }],
			deps
		);
		expect(result).toEqual({ files: [], processedTokens: [] });
		expect(store).toEqual([]);
	});
	it('also acknowledges a token that reactivates an existing local branch', async () => {
		vi.mocked(desktop.isDesktop).mockReturnValue(true);
		const existing = makeFile({ id: 'existing', content: 'local' });
		vi.mocked(fsa.getPathLink).mockResolvedValue({ kind: 'path', path: '/tmp/same.md' });
		vi.mocked(diskTauri.tauriOpenNativeGrants).mockResolvedValue({
			files: [
				{
					token: 'same-token',
					name: 'same.md',
					content: 'disk',
					path: '/tmp/same.md',
					lastModified: 1,
					size: 4,
					revision: 'r1',
					link: { kind: 'path', path: '/tmp/same.md' }
				}
			],
			failed: 0
		});
		const result = await openPathsFromDesktop(
			[{ token: 'same-token', path: '/tmp/same.md', stat: null }],
			{
				getFile: () => existing,
				getFiles: () => [existing],
				onCreate: vi.fn(),
				onActivate: vi.fn(),
				scheduleSave: vi.fn()
			}
		);
		expect(result.processedTokens).toEqual(['same-token']);
		expect(result.files).toEqual([existing]);
	});
});
