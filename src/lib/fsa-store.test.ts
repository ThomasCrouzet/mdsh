import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	checkHandle,
	deleteHandle,
	getHandle,
	isDirectoryPickerSupported,
	isFSASupported,
	listHandles,
	pickAndOpen,
	pickSaveTarget,
	requestPermission,
	saveHandle,
	writeHandle
} from './fsa';

// Use a dedicated IDB for handles (mdsh-fs), separate from Dexie (mdsh). Clear it between tests.
// The cached module-level connection opens again automatically after database deletion.
async function wipeHandleDB() {
	await new Promise<void>((resolve) => {
		const req = indexedDB.deleteDatabase('mdsh-fs');
		req.onsuccess = () => resolve();
		req.onerror = () => resolve();
		req.onblocked = () => resolve();
	});
}

// Reset FSA globals on window to prevent state from leaking between tests.
function resetFSAGlobals() {
	Reflect.deleteProperty(window, 'showOpenFilePicker');
	Reflect.deleteProperty(window, 'showSaveFilePicker');
	Reflect.deleteProperty(window, 'showDirectoryPicker');
}

beforeEach(async () => {
	resetFSAGlobals();
	await wipeHandleDB();
});

afterEach(async () => {
	resetFSAGlobals();
	await wipeHandleDB();
});

describe('isFSASupported / isDirectoryPickerSupported', () => {
	it('returns false when no FSA API is available', () => {
		expect(isFSASupported()).toBe(false);
	});

	it('returns true when open and save pickers are available', () => {
		(window as unknown as { showOpenFilePicker: () => void }).showOpenFilePicker = () => {};
		(window as unknown as { showSaveFilePicker: () => void }).showSaveFilePicker = () => {};
		expect(isFSASupported()).toBe(true);
	});

	it('returns false when only the save picker is available', () => {
		(window as unknown as { showSaveFilePicker: () => void }).showSaveFilePicker = () => {};
		expect(isFSASupported()).toBe(false);
	});

	it('detects whether the directory picker is available', () => {
		expect(isDirectoryPickerSupported()).toBe(false);
		(window as unknown as { showDirectoryPicker: () => void }).showDirectoryPicker = () => {};
		expect(isDirectoryPickerSupported()).toBe(true);
	});
});

describe('saveHandle / getHandle / deleteHandle (persistance IDB)', () => {
	it('persists a handle and reads it by ID', async () => {
		const handle = { name: 'doc.md' } as unknown as FileSystemFileHandle;
		await saveHandle('round-1', handle);
		const got = await getHandle('round-1');
		expect((got as unknown as { name: string }).name).toBe('doc.md');
	});

	it('returns null from getHandle for an unknown ID', async () => {
		expect(await getHandle('absent')).toBeNull();
	});

	it('replaces an existing value with saveHandle', async () => {
		await saveHandle('dup', { name: 'v1' } as unknown as FileSystemFileHandle);
		await saveHandle('dup', { name: 'v2' } as unknown as FileSystemFileHandle);
		expect((await getHandle('dup')) as unknown as { name: string }).toMatchObject({ name: 'v2' });
	});

	it('removes an existing entry with deleteHandle', async () => {
		await saveHandle('rm', { name: 'rm.md' } as unknown as FileSystemFileHandle);
		expect(await getHandle('rm')).not.toBeNull();
		await deleteHandle('rm');
		expect(await getHandle('rm')).toBeNull();
	});

	it('does not throw when deleteHandle receives an unknown ID', async () => {
		await expect(deleteHandle('jamais-vu')).resolves.toBeUndefined();
	});

	it('reuses the cached IndexedDB connection', async () => {
		// The first call opens the connection, and later calls reuse it.
		// Chained calls must remain consistent even though the module cache is not directly visible.
		await saveHandle('c1', { name: 'c1' } as unknown as FileSystemFileHandle);
		await saveHandle('c2', { name: 'c2' } as unknown as FileSystemFileHandle);
		expect((await getHandle('c1')) as unknown as { name: string }).toMatchObject({ name: 'c1' });
		expect((await getHandle('c2')) as unknown as { name: string }).toMatchObject({ name: 'c2' });
	});
});

describe('listHandles', () => {
	it('returns an empty list without stored handles', async () => {
		expect(await listHandles()).toEqual([]);
	});

	it('lists all stored handles with their IDs', async () => {
		await saveHandle('id-a', { name: 'a.md' } as unknown as FileSystemFileHandle);
		await saveHandle('id-b', { name: 'b.md' } as unknown as FileSystemFileHandle);
		await saveHandle('id-c', { name: 'c.md' } as unknown as FileSystemFileHandle);
		const list = await listHandles();
		expect(list).toHaveLength(3);
		const byId = Object.fromEntries(
			list.map((e) => [e.id, (e.handle as unknown as { name: string }).name])
		);
		expect(byId).toEqual({ 'id-a': 'a.md', 'id-b': 'b.md', 'id-c': 'c.md' });
	});

	it('reflects a deletion', async () => {
		await saveHandle('keep', { name: 'keep' } as unknown as FileSystemFileHandle);
		await saveHandle('drop', { name: 'drop' } as unknown as FileSystemFileHandle);
		await deleteHandle('drop');
		const ids = (await listHandles()).map((e) => e.id);
		expect(ids).toEqual(['keep']);
	});

	it('returns an empty list when IndexedDB is unavailable', async () => {
		// Simulate unavailable IndexedDB. openHandleDB rejects, and listHandles must return [] without throwing.
		const original = globalThis.indexedDB;
		Object.defineProperty(globalThis, 'indexedDB', {
			value: {
				open: () => {
					const req: Record<string, unknown> = { error: new Error('no idb') };
					queueMicrotask(() => {
						(req.onerror as (() => void) | undefined)?.();
					});
					return req;
				}
			},
			configurable: true
		});
		try {
			expect(await listHandles()).toEqual([]);
		} finally {
			Object.defineProperty(globalThis, 'indexedDB', {
				value: original,
				configurable: true
			});
		}
	});
});

describe('requestPermission', () => {
	it('returns false when the handle does not support permissions', async () => {
		expect(await requestPermission({} as unknown as FileSystemFileHandle)).toBe(false);
	});

	it('returns true without a request when permission is granted', async () => {
		const request = vi.fn();
		const handle = {
			queryPermission: vi.fn().mockResolvedValue('granted'),
			requestPermission: request
		} as unknown as FileSystemFileHandle;
		expect(await requestPermission(handle, 'readwrite')).toBe(true);
		expect(request).not.toHaveBeenCalled();
	});

	it('requests permission after a prompt result', async () => {
		const handle = {
			queryPermission: vi.fn().mockResolvedValue('prompt'),
			requestPermission: vi.fn().mockResolvedValue('granted')
		} as unknown as FileSystemFileHandle;
		expect(await requestPermission(handle)).toBe(true);
	});

	it('returns false when the request is denied', async () => {
		const handle = {
			queryPermission: vi.fn().mockResolvedValue('prompt'),
			requestPermission: vi.fn().mockResolvedValue('denied')
		} as unknown as FileSystemFileHandle;
		expect(await requestPermission(handle)).toBe(false);
	});

	it('uses readwrite as the default mode', async () => {
		const query = vi.fn().mockResolvedValue('granted');
		const handle = {
			queryPermission: query,
			requestPermission: vi.fn()
		} as unknown as FileSystemFileHandle;
		await requestPermission(handle);
		expect(query).toHaveBeenCalledWith({ mode: 'readwrite' });
	});
});

describe('pickAndOpen', () => {
	it('returns an empty list when FSA is unavailable', async () => {
		expect(await pickAndOpen()).toEqual([]);
	});

	it('resolves handles and reads each file', async () => {
		const fa = new File(['# A'], 'a.md', { type: 'text/markdown' });
		const fb = new File(['# B'], 'b.md', { type: 'text/markdown' });
		const h1 = { getFile: vi.fn().mockResolvedValue(fa) };
		const h2 = { getFile: vi.fn().mockResolvedValue(fb) };
		(window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi
			.fn()
			.mockResolvedValue([h1, h2]);
		(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi.fn();
		const got = await pickAndOpen();
		expect(got.map((g) => g.file.name)).toEqual(['a.md', 'b.md']);
		expect(got[0]!.handle).toBe(h1);
	});

	it('returns an empty list after AbortError cancellation', async () => {
		const err = Object.assign(new Error('abort'), { name: 'AbortError' });
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
		expect(await pickSaveTarget('x.md')).toBeNull();
	});

	it('returns the selected handle', async () => {
		const fake = { name: 'out.md' } as unknown as FileSystemFileHandle;
		(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi
			.fn()
			.mockResolvedValue(fake);
		(window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi.fn();
		expect(await pickSaveTarget('out.md')).toBe(fake);
	});

	it('returns null after AbortError cancellation', async () => {
		const err = Object.assign(new Error('abort'), { name: 'AbortError' });
		(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi
			.fn()
			.mockRejectedValue(err);
		(window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi.fn();
		expect(await pickSaveTarget('out.md')).toBeNull();
	});

	it('returns other errors', async () => {
		(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi
			.fn()
			.mockRejectedValue(new Error('disk full'));
		(window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi.fn();
		await expect(pickSaveTarget('out.md')).rejects.toThrow('disk full');
	});

	it('passes suggestedName to the picker', async () => {
		const picker = vi.fn().mockResolvedValue({ name: 'y' });
		(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = picker;
		(window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi.fn();
		await pickSaveTarget('mon-fichier.md');
		expect(picker).toHaveBeenCalledWith(
			expect.objectContaining({ suggestedName: 'mon-fichier.md' })
		);
	});
});

describe('writeHandle', () => {
	it('writes content through createWritable and close', async () => {
		const write = vi.fn().mockResolvedValue(undefined);
		const close = vi.fn().mockResolvedValue(undefined);
		const handle = {
			createWritable: vi.fn().mockResolvedValue({ write, close })
		} as unknown as FileSystemFileHandle;
		await writeHandle(handle, 'salut');
		expect(write).toHaveBeenCalledWith('salut');
		expect(close).toHaveBeenCalled();
	});

	it('throws when createWritable is unavailable', async () => {
		await expect(writeHandle({} as unknown as FileSystemFileHandle, 'x')).rejects.toThrow(
			/createWritable/
		);
	});
});

describe('checkHandle', () => {
	it('returns broken when the handle has no queryPermission', async () => {
		expect(await checkHandle({} as unknown as FileSystemFileHandle)).toBe('broken');
	});

	it('returns ok when permission is granted and getFile resolves', async () => {
		const handle = {
			queryPermission: vi.fn().mockResolvedValue('granted'),
			getFile: vi.fn().mockResolvedValue(new File(['x'], 'x.md'))
		} as unknown as FileSystemFileHandle;
		expect(await checkHandle(handle)).toBe('ok');
	});

	it('returns permission-needed after a prompt result', async () => {
		const getFile = vi.fn();
		const handle = {
			queryPermission: vi.fn().mockResolvedValue('prompt'),
			getFile
		} as unknown as FileSystemFileHandle;
		expect(await checkHandle(handle)).toBe('permission-needed');
		// Do not read the file when permission is not granted.
		expect(getFile).not.toHaveBeenCalled();
	});

	it('returns broken when queryPermission throws', async () => {
		const handle = {
			queryPermission: vi.fn().mockRejectedValue(new Error('revoked')),
			getFile: vi.fn()
		} as unknown as FileSystemFileHandle;
		expect(await checkHandle(handle)).toBe('broken');
	});

	it('returns broken when getFile throws after permission', async () => {
		const handle = {
			queryPermission: vi.fn().mockResolvedValue('granted'),
			getFile: vi
				.fn()
				.mockRejectedValue(Object.assign(new Error('gone'), { name: 'NotFoundError' }))
		} as unknown as FileSystemFileHandle;
		expect(await checkHandle(handle)).toBe('broken');
	});
});
