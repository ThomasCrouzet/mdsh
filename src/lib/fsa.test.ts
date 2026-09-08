import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	deleteHandle,
	getFsaLink,
	getHandle,
	getPathLink,
	isFSASupported,
	listDiskLinks,
	listHandles,
	pickDirectoryFiles,
	pickAndOpen,
	pickSaveTarget,
	requestPermission,
	revisionForFile,
	revisionForText,
	saveHandle,
	savePathLink,
	writeHandle
} from './fsa';
import { db, DISK_LINK_EPOCH_KEY } from './db';

// Use an IndexedDB database for handles, separate from the mdsh Dexie database.
async function wipeHandleDB() {
	await new Promise<void>((resolve) => {
		const req = indexedDB.deleteDatabase('mdsh-fs');
		req.onsuccess = () => resolve();
		req.onerror = () => resolve();
		req.onblocked = () => resolve();
	});
}

beforeEach(async () => {
	await wipeHandleDB();
	await db.metadata.clear();
	// Reset FSA globals between tests to prevent state leaks.
	Reflect.deleteProperty(window, 'showOpenFilePicker');
	Reflect.deleteProperty(window, 'showSaveFilePicker');
	Reflect.deleteProperty(window, 'showDirectoryPicker');
});

afterEach(async () => {
	await wipeHandleDB();
	await db.metadata.clear();
});

describe('isFSASupported', () => {
	it('returns false when the APIs are unavailable', () => {
		expect(isFSASupported()).toBe(false);
	});

	it('returns true when both file pickers are available', () => {
		(window as unknown as { showOpenFilePicker: () => void }).showOpenFilePicker = () => {};
		(window as unknown as { showSaveFilePicker: () => void }).showSaveFilePicker = () => {};
		expect(isFSASupported()).toBe(true);
	});

	it('returns false when only one file picker is available', () => {
		(window as unknown as { showOpenFilePicker: () => void }).showOpenFilePicker = () => {};
		expect(isFSASupported()).toBe(false);
	});
});

describe('saveHandle / getHandle / deleteHandle', () => {
	it('stores a handle and reads it by ID', async () => {
		const handle = { name: 'fake.md' } as unknown as FileSystemFileHandle;
		await saveHandle('id-1', handle, 'sha256:known');
		const got = await getHandle('id-1');
		expect(got).toEqual(handle);
		expect(await getFsaLink('id-1')).toEqual({
			handle,
			revision: 'sha256:known',
			epoch: 'legacy'
		});
	});

	it('returns null without a handle for the ID', async () => {
		const got = await getHandle('missing');
		expect(got).toBeNull();
	});

	it('replaces an existing handle with a second saveHandle call', async () => {
		const h1 = { name: 'a.md' } as unknown as FileSystemFileHandle;
		const h2 = { name: 'b.md' } as unknown as FileSystemFileHandle;
		await saveHandle('id-x', h1);
		await saveHandle('id-x', h2);
		const got = await getHandle('id-x');
		expect((got as unknown as { name: string }).name).toBe('b.md');
	});

	it('removes an entry with deleteHandle', async () => {
		const handle = { name: 'del.md' } as unknown as FileSystemFileHandle;
		await saveHandle('to-del', handle);
		expect(await getHandle('to-del')).not.toBeNull();
		await deleteHandle('to-del');
		expect(await getHandle('to-del')).toBeNull();
	});

	it('does not throw when deleteHandle receives an unknown ID', async () => {
		await expect(deleteHandle('never-existed')).resolves.toBeUndefined();
	});

	it('stores multiple independent handles', async () => {
		await saveHandle('a', { name: 'a' } as unknown as FileSystemFileHandle);
		await saveHandle('b', { name: 'b' } as unknown as FileSystemFileHandle);
		expect((await getHandle('a')) as unknown as { name: string }).toMatchObject({ name: 'a' });
		expect((await getHandle('b')) as unknown as { name: string }).toMatchObject({ name: 'b' });
	});

	it('rejects handles from a previous restore epoch', async () => {
		const handle = { name: 'old.md' } as unknown as FileSystemFileHandle;
		await saveHandle('old', handle, 'sha256:old');
		await db.metadata.put({ key: DISK_LINK_EPOCH_KEY, value: 'replacement' });

		expect(await getHandle('old')).toBeNull();
		expect(await getFsaLink('old')).toBeNull();
		expect(await listDiskLinks()).toEqual([]);
	});

	it('keeps a captured pre-restore epoch on a late handle write', async () => {
		const handle = { name: 'late.md' } as unknown as FileSystemFileHandle;
		await db.metadata.put({ key: DISK_LINK_EPOCH_KEY, value: 'after-restore' });

		await saveHandle('late', handle, 'sha256:late', 'before-restore');

		expect(await getFsaLink('late')).toBeNull();
	});
});

describe('disk revisions', () => {
	it('uses the same content hash for text and files', async () => {
		const expected = 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
		expect(await revisionForText('abc')).toBe(expected);
		expect(await revisionForFile(new File(['abc'], 'note.md'))).toBe(expected);
	});
});

describe('desktop path links', () => {
	it('stores, reads, and lists a path link separately from handles', async () => {
		await savePathLink('path-id', { kind: 'path', path: '/tmp/note.md' });

		expect(await getPathLink('path-id')).toEqual({ kind: 'path', path: '/tmp/note.md' });
		expect(await getHandle('path-id')).toBeNull();
		expect(await listDiskLinks()).toEqual([
			{
				id: 'path-id',
				kind: 'path',
				path: '/tmp/note.md',
				label: 'note.md'
			}
		]);
		expect(await listHandles()).toEqual([]);
	});

	it('lists FSA handles and path links together', async () => {
		const handle = { name: 'browser.md' } as FileSystemFileHandle;
		await saveHandle('fsa-id', handle);
		await savePathLink('path-id', { kind: 'path', path: 'C:\\notes\\desktop.md' });

		expect(await getPathLink('fsa-id')).toBeNull();
		expect(await listDiskLinks()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: 'fsa-id', kind: 'fsa', label: 'browser.md' }),
				expect.objectContaining({ id: 'path-id', kind: 'path', label: 'desktop.md' })
			])
		);
		expect(await listHandles()).toEqual([{ id: 'fsa-id', handle }]);
	});

	it('uses IDs and paths as fallback labels', async () => {
		const handle = {} as FileSystemFileHandle;
		await saveHandle('sans-nom', handle);
		await savePathLink('racine', { kind: 'path', path: '/' });

		expect(await listDiskLinks()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: 'sans-nom', kind: 'fsa', label: 'sans-nom' }),
				expect.objectContaining({ id: 'racine', kind: 'path', label: '/' })
			])
		);
	});
});

describe('pickDirectoryFiles', () => {
	it('returns a picker error that is not a cancellation', async () => {
		(window as unknown as { showDirectoryPicker: () => Promise<never> }).showDirectoryPicker = vi
			.fn()
			.mockRejectedValue(new Error('permission refusée'));

		await expect(pickDirectoryFiles()).rejects.toThrow('permission refusée');
	});
});

describe('requestPermission', () => {
	it('returns true without a request when permission is granted', async () => {
		const requestSpy = vi.fn();
		const handle = {
			queryPermission: vi.fn().mockResolvedValue('granted'),
			requestPermission: requestSpy
		} as unknown as FileSystemFileHandle;
		const ok = await requestPermission(handle, 'readwrite');
		expect(ok).toBe(true);
		expect(requestSpy).not.toHaveBeenCalled();
	});

	it('requests permission after a prompt result', async () => {
		const handle = {
			queryPermission: vi.fn().mockResolvedValue('prompt'),
			requestPermission: vi.fn().mockResolvedValue('granted')
		} as unknown as FileSystemFileHandle;
		expect(await requestPermission(handle)).toBe(true);
	});

	it('returns false when requestPermission denies access', async () => {
		const handle = {
			queryPermission: vi.fn().mockResolvedValue('prompt'),
			requestPermission: vi.fn().mockResolvedValue('denied')
		} as unknown as FileSystemFileHandle;
		expect(await requestPermission(handle)).toBe(false);
	});

	it('returns false when the handle does not support permissions', async () => {
		const handle = {} as unknown as FileSystemFileHandle;
		expect(await requestPermission(handle)).toBe(false);
	});

	it('passes the mode to the handle', async () => {
		const query = vi.fn().mockResolvedValue('granted');
		const handle = {
			queryPermission: query,
			requestPermission: vi.fn()
		} as unknown as FileSystemFileHandle;
		await requestPermission(handle, 'read');
		expect(query).toHaveBeenCalledWith({ mode: 'read' });
	});
});

describe('pickAndOpen', () => {
	it('returns an empty list when FSA is unavailable', async () => {
		expect(await pickAndOpen()).toEqual([]);
	});

	it('resolves handles and calls getFile on each handle', async () => {
		const file1 = new File(['# A'], 'a.md', { type: 'text/markdown' });
		const file2 = new File(['# B'], 'b.md', { type: 'text/markdown' });
		const h1 = { getFile: vi.fn().mockResolvedValue(file1) };
		const h2 = { getFile: vi.fn().mockResolvedValue(file2) };
		(window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi
			.fn()
			.mockResolvedValue([h1, h2]);
		(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi.fn();
		const got = await pickAndOpen();
		expect(got).toHaveLength(2);
		expect(got[0]!.file.name).toBe('a.md');
		expect(got[1]!.file.name).toBe('b.md');
	});

	it('returns an empty list after AbortError cancellation', async () => {
		const err = new Error('abort');
		err.name = 'AbortError';
		(window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi
			.fn()
			.mockRejectedValue(err);
		(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi.fn();
		expect(await pickAndOpen()).toEqual([]);
	});

	it('returns other errors', async () => {
		(window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi
			.fn()
			.mockRejectedValue(new Error('boom'));
		(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi.fn();
		await expect(pickAndOpen()).rejects.toThrow('boom');
	});
});

describe('pickSaveTarget', () => {
	it('returns null when FSA is unavailable', async () => {
		expect(await pickSaveTarget('foo.md')).toBeNull();
	});

	it('returns the picker handle', async () => {
		const fakeHandle = { name: 'saved.md' } as unknown as FileSystemFileHandle;
		(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi
			.fn()
			.mockResolvedValue(fakeHandle);
		(window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi.fn();
		expect(await pickSaveTarget('foo.md')).toBe(fakeHandle);
	});

	it('returns null after user cancellation', async () => {
		const err = new Error('abort');
		err.name = 'AbortError';
		(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi
			.fn()
			.mockRejectedValue(err);
		(window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi.fn();
		expect(await pickSaveTarget('foo.md')).toBeNull();
	});

	it('passes suggestedName', async () => {
		const picker = vi.fn().mockResolvedValue({ name: 'x' });
		(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = picker;
		(window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi.fn();
		await pickSaveTarget('mon-doc.md');
		expect(picker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: 'mon-doc.md' }));
	});
});

describe('writeHandle', () => {
	it('writes content through createWritable and close', async () => {
		const write = vi.fn().mockResolvedValue(undefined);
		const close = vi.fn().mockResolvedValue(undefined);
		const handle = {
			createWritable: vi.fn().mockResolvedValue({ write, close })
		} as unknown as FileSystemFileHandle;
		await writeHandle(handle, 'bonjour');
		expect(write).toHaveBeenCalledWith('bonjour');
		expect(close).toHaveBeenCalled();
	});

	it('throws when createWritable is unavailable', async () => {
		const handle = {} as unknown as FileSystemFileHandle;
		await expect(writeHandle(handle, 'x')).rejects.toThrow(/createWritable/);
	});
});
