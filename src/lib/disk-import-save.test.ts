import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openFromDisk, saveToDisk, type DiskSyncDeps } from './disk-sync';
import {
	setTauriDiskIoForTests,
	type DiskFileMeta,
	type NativeDiskGrant,
	type TauriDiskIo
} from './disk-tauri';
import { deleteHandle, getPathLink } from './fsa';
import { db, type DraftRow } from './db';
import { promptStore } from './prompt.svelte';
import type { FileItem } from './types';

const DISK_PATH = '/tmp/issue-78.md';
const TEST_IDS = ['issue-78-first-save', 'issue-78-reimport', 'issue-78-conflict'] as const;

interface NativeFileState {
	content: string;
	stat: DiskFileMeta;
}

function createNativeIo(token: string, nativeFile: NativeFileState): TauriDiskIo {
	const grant = (): NativeDiskGrant => ({ token, path: DISK_PATH, stat: { ...nativeFile.stat } });
	const requireToken = (candidate: string): void => {
		if (candidate !== token) throw new Error('invalid or expired disk capability');
	};
	return {
		openGrants: vi.fn(async () => [grant()]),
		openDirectoryGrants: vi.fn(async () => []),
		saveGrant: vi.fn(async () => null),
		saveExportGrant: vi.fn(async () => null),
		readFile: vi.fn(async (candidate) => {
			requireToken(candidate);
			return { content: nativeFile.content, stat: { ...nativeFile.stat } };
		}),
		writeText: vi.fn(async (candidate, content, expectedRevision, force) => {
			requireToken(candidate);
			if (!force && expectedRevision !== nativeFile.stat.revision) {
				throw new Error('disk conflict: target changed since it was opened');
			}
			nativeFile.content = content;
			nativeFile.stat = {
				lastModified: nativeFile.stat.lastModified + 1,
				size: new TextEncoder().encode(content).byteLength,
				revision: `sha256:written-${nativeFile.stat.lastModified + 1}`
			};
			return { ...nativeFile.stat };
		}),
		writeBytes: vi.fn(async (candidate) => {
			requireToken(candidate);
			return { ...nativeFile.stat };
		}),
		stat: vi.fn(async (candidate) => {
			requireToken(candidate);
			return { ...nativeFile.stat };
		})
	};
}

function createDeps(id: string, files: FileItem[]): DiskSyncDeps {
	return {
		getFile: (candidate) => files.find((file) => file.id === candidate),
		getFiles: () => files,
		onCreate: (name, content) => {
			const now = Date.now();
			const file: FileItem = {
				id,
				name,
				content,
				createdAt: now,
				updatedAt: now,
				dirty: true
			};
			files.push(file);
			return file;
		},
		onActivate: vi.fn(),
		scheduleSave: vi.fn()
	};
}

function nativeFile(): NativeFileState {
	return {
		content: '# Existing file',
		stat: {
			lastModified: 100,
			size: 15,
			revision: 'sha256:initial'
		}
	};
}

async function persistAndReload(file: FileItem): Promise<FileItem[]> {
	const draft: DraftRow = {
		id: file.id,
		name: file.name,
		content: file.content,
		createdAt: file.createdAt,
		updatedAt: file.updatedAt,
		order: 0,
		open: true
	};
	await db.drafts.put(draft);
	const storedDrafts = await db.drafts.where('id').equals(file.id).toArray();
	return storedDrafts.map((row) => ({
		id: row.id,
		name: row.name,
		content: row.content,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		dirty: false,
		linkedToDisk: true
	}));
}

beforeEach(() => {
	Object.defineProperty(window, '__TAURI_INTERNALS__', {
		value: {},
		configurable: true
	});
});

afterEach(async () => {
	setTauriDiskIoForTests(null);
	for (const id of TEST_IDS) await deleteHandle(id);
	await db.drafts.bulkDelete([...TEST_IDS]);
	vi.restoreAllMocks();
	Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
});

describe('desktop import and save integration', () => {
	it('saves an imported native file without opening a save dialog', async () => {
		const state = nativeFile();
		const io = createNativeIo('session-one', state);
		const files: FileItem[] = [];
		const deps = createDeps(TEST_IDS[0], files);
		setTauriDiskIoForTests(io);

		const imported = await openFromDisk(deps);
		imported[0]!.content = '# Edited file';

		expect(imported).toHaveLength(1);
		expect(await getPathLink(TEST_IDS[0])).toEqual({ kind: 'path', path: DISK_PATH });
		expect(await saveToDisk(TEST_IDS[0], deps)).toBe(true);
		expect(state.content).toBe('# Edited file');
		expect(io.saveGrant).not.toHaveBeenCalled();
		expect(io.writeText).toHaveBeenCalledWith(
			'session-one',
			'# Edited file',
			'sha256:initial',
			false
		);
	});

	it('renews the native grant after restart and saves without a save dialog', async () => {
		const state = nativeFile();
		const files: FileItem[] = [];
		const deps = createDeps(TEST_IDS[1], files);
		const firstSession = createNativeIo('session-one', state);
		setTauriDiskIoForTests(firstSession);

		const [firstImport] = await openFromDisk(deps);
		firstImport!.content = '# First edit';
		expect(await saveToDisk(TEST_IDS[1], deps)).toBe(true);
		expect(state.content).toBe('# First edit');
		expect(firstSession.saveGrant).not.toHaveBeenCalled();
		const restartedFiles = await persistAndReload(firstImport!);

		const secondSession = createNativeIo('session-two', state);
		setTauriDiskIoForTests(secondSession);
		expect(await getPathLink(TEST_IDS[1])).toEqual({ kind: 'path', path: DISK_PATH });
		const restartedDeps = createDeps(TEST_IDS[1], restartedFiles);
		expect(restartedFiles[0]).not.toBe(firstImport);
		expect(restartedFiles[0]?.diskRevision).toBeUndefined();
		const reimported = await openFromDisk(restartedDeps);
		const revisionBeforeSave = state.stat.revision;
		reimported[0]!.content = '# Second edit';
		const confirmOverwrite = vi.spyOn(promptStore, 'confirm').mockResolvedValue(false);

		expect(reimported).toEqual([restartedFiles[0]]);
		expect(restartedFiles).toHaveLength(1);
		expect(await getPathLink(TEST_IDS[1])).toEqual({ kind: 'path', path: DISK_PATH });
		expect(await saveToDisk(TEST_IDS[1], restartedDeps)).toBe(true);
		expect(confirmOverwrite).not.toHaveBeenCalled();
		expect(state.content).toBe('# Second edit');
		expect(secondSession.openGrants).toHaveBeenCalledOnce();
		expect(secondSession.saveGrant).not.toHaveBeenCalled();
		expect(secondSession.writeText).toHaveBeenCalledWith(
			'session-two',
			'# Second edit',
			revisionBeforeSave,
			false
		);
	});

	it('requires confirmation when the reloaded draft differs from the disk file', async () => {
		const state = nativeFile();
		const files: FileItem[] = [];
		const firstSession = createNativeIo('session-one', state);
		setTauriDiskIoForTests(firstSession);
		const [firstImport] = await openFromDisk(createDeps(TEST_IDS[2], files));
		firstImport!.content = '# Local draft';
		const restartedFiles = await persistAndReload(firstImport!);

		const secondSession = createNativeIo('session-two', state);
		setTauriDiskIoForTests(secondSession);
		const restartedDeps = createDeps(TEST_IDS[2], restartedFiles);
		const reimported = await openFromDisk(restartedDeps);
		const confirmOverwrite = vi.spyOn(promptStore, 'confirm').mockResolvedValue(false);

		expect(reimported).toEqual([restartedFiles[0]]);
		expect(restartedFiles[0]?.content).toBe('# Local draft');
		expect(restartedFiles[0]?.diskRevision).toBeUndefined();
		expect(await saveToDisk(TEST_IDS[2], restartedDeps)).toBe(false);
		expect(confirmOverwrite).toHaveBeenCalledOnce();
		expect(state.content).toBe('# Existing file');
		expect(secondSession.saveGrant).not.toHaveBeenCalled();
		expect(secondSession.writeText).toHaveBeenCalledWith(
			'session-two',
			'# Local draft',
			null,
			false
		);
	});
});
