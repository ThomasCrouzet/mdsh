import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkHandle, listHandles, pickAndOpen, pickSaveTarget, requestPermission } from './fsa';

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

describe('listHandles', () => {
	it('reports an error when IndexedDB is unavailable', async () => {
		// Simulate unavailable IndexedDB. The caller must distinguish this error from an empty store.
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
			await expect(listHandles()).rejects.toThrow('no idb');
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

	it('returns false when the request is denied', async () => {
		const handle = {
			queryPermission: vi.fn().mockResolvedValue('prompt'),
			requestPermission: vi.fn().mockResolvedValue('denied')
		} as unknown as FileSystemFileHandle;
		expect(await requestPermission(handle)).toBe(false);
	});
});

describe('pickAndOpen', () => {
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
});

describe('checkHandle', () => {
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
