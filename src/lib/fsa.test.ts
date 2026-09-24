import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	getFsaLink,
	getHandle,
	getPathLink,
	listDiskLinks,
	listHandles,
	revisionForFile,
	revisionForText,
	saveHandle,
	savePathLink
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
});

afterEach(async () => {
	await wipeHandleDB();
	await db.metadata.clear();
});

describe('saveHandle / getHandle', () => {
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
});
