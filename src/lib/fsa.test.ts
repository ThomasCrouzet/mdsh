import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	deleteHandle,
	getHandle,
	getPathLink,
	isFSASupported,
	listDiskLinks,
	listHandles,
	pickDirectoryFiles,
	pickAndOpen,
	pickSaveTarget,
	requestPermission,
	saveHandle,
	savePathLink,
	writeHandle
} from './fsa';

// IDB dédiée aux handles - isolée de Dexie (mdsh). Purge entre chaque test.
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
	// Reset des globals FSA entre tests - évite les fuites d'état.
	Reflect.deleteProperty(window, 'showOpenFilePicker');
	Reflect.deleteProperty(window, 'showSaveFilePicker');
	Reflect.deleteProperty(window, 'showDirectoryPicker');
});

afterEach(async () => {
	await wipeHandleDB();
});

describe('isFSASupported', () => {
	it('retourne false quand les APIs ne sont pas exposées', () => {
		expect(isFSASupported()).toBe(false);
	});

	it('retourne true quand showOpenFilePicker et showSaveFilePicker sont présents', () => {
		(window as unknown as { showOpenFilePicker: () => void }).showOpenFilePicker = () => {};
		(window as unknown as { showSaveFilePicker: () => void }).showSaveFilePicker = () => {};
		expect(isFSASupported()).toBe(true);
	});

	it("retourne false si l'une seulement est présente", () => {
		(window as unknown as { showOpenFilePicker: () => void }).showOpenFilePicker = () => {};
		expect(isFSASupported()).toBe(false);
	});
});

describe('saveHandle / getHandle / deleteHandle', () => {
	it('stocke un handle et le relit par id', async () => {
		const handle = { name: 'fake.md' } as unknown as FileSystemFileHandle;
		await saveHandle('id-1', handle);
		const got = await getHandle('id-1');
		expect(got).toEqual(handle);
	});

	it('retourne null si aucun handle pour cet id', async () => {
		const got = await getHandle('missing');
		expect(got).toBeNull();
	});

	it("overrides le handle existant lors d'une deuxième saveHandle", async () => {
		const h1 = { name: 'a.md' } as unknown as FileSystemFileHandle;
		const h2 = { name: 'b.md' } as unknown as FileSystemFileHandle;
		await saveHandle('id-x', h1);
		await saveHandle('id-x', h2);
		const got = await getHandle('id-x');
		expect((got as unknown as { name: string }).name).toBe('b.md');
	});

	it("deleteHandle supprime l'entrée", async () => {
		const handle = { name: 'del.md' } as unknown as FileSystemFileHandle;
		await saveHandle('to-del', handle);
		expect(await getHandle('to-del')).not.toBeNull();
		await deleteHandle('to-del');
		expect(await getHandle('to-del')).toBeNull();
	});

	it('deleteHandle sur id inexistant ne throw pas', async () => {
		await expect(deleteHandle('never-existed')).resolves.toBeUndefined();
	});

	it('stocke plusieurs handles indépendants', async () => {
		await saveHandle('a', { name: 'a' } as unknown as FileSystemFileHandle);
		await saveHandle('b', { name: 'b' } as unknown as FileSystemFileHandle);
		expect((await getHandle('a')) as unknown as { name: string }).toMatchObject({ name: 'a' });
		expect((await getHandle('b')) as unknown as { name: string }).toMatchObject({ name: 'b' });
	});
});

describe('liens chemin desktop', () => {
	it('stocke, relit et liste un lien chemin sans le confondre avec un handle', async () => {
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

	it('liste ensemble les handles FSA et les liens chemin', async () => {
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

	it('utilise les identifiants et chemins comme libellés de secours', async () => {
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
	it('propage une erreur du sélecteur qui n’est pas une annulation', async () => {
		(window as unknown as { showDirectoryPicker: () => Promise<never> }).showDirectoryPicker = vi
			.fn()
			.mockRejectedValue(new Error('permission refusée'));

		await expect(pickDirectoryFiles()).rejects.toThrow('permission refusée');
	});
});

describe('requestPermission', () => {
	it('retourne true si queryPermission === "granted" (skip requestPermission)', async () => {
		const requestSpy = vi.fn();
		const handle = {
			queryPermission: vi.fn().mockResolvedValue('granted'),
			requestPermission: requestSpy
		} as unknown as FileSystemFileHandle;
		const ok = await requestPermission(handle, 'readwrite');
		expect(ok).toBe(true);
		expect(requestSpy).not.toHaveBeenCalled();
	});

	it('appelle requestPermission si query retourne "prompt" puis "granted"', async () => {
		const handle = {
			queryPermission: vi.fn().mockResolvedValue('prompt'),
			requestPermission: vi.fn().mockResolvedValue('granted')
		} as unknown as FileSystemFileHandle;
		expect(await requestPermission(handle)).toBe(true);
	});

	it('retourne false si requestPermission refuse', async () => {
		const handle = {
			queryPermission: vi.fn().mockResolvedValue('prompt'),
			requestPermission: vi.fn().mockResolvedValue('denied')
		} as unknown as FileSystemFileHandle;
		expect(await requestPermission(handle)).toBe(false);
	});

	it('retourne false si le handle ne supporte pas les permissions', async () => {
		const handle = {} as unknown as FileSystemFileHandle;
		expect(await requestPermission(handle)).toBe(false);
	});

	it('passe le mode au handle', async () => {
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
	it('retourne [] si FSA non supportée', async () => {
		expect(await pickAndOpen()).toEqual([]);
	});

	it('résout les handles et appelle getFile() sur chacun', async () => {
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

	it("retourne [] si l'utilisateur annule (AbortError)", async () => {
		const err = new Error('abort');
		err.name = 'AbortError';
		(window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi
			.fn()
			.mockRejectedValue(err);
		(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi.fn();
		expect(await pickAndOpen()).toEqual([]);
	});

	it('propage les autres erreurs', async () => {
		(window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi
			.fn()
			.mockRejectedValue(new Error('boom'));
		(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi.fn();
		await expect(pickAndOpen()).rejects.toThrow('boom');
	});
});

describe('pickSaveTarget', () => {
	it('retourne null si FSA non supportée', async () => {
		expect(await pickSaveTarget('foo.md')).toBeNull();
	});

	it('retourne le handle du picker', async () => {
		const fakeHandle = { name: 'saved.md' } as unknown as FileSystemFileHandle;
		(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi
			.fn()
			.mockResolvedValue(fakeHandle);
		(window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi.fn();
		expect(await pickSaveTarget('foo.md')).toBe(fakeHandle);
	});

	it("retourne null si l'utilisateur annule", async () => {
		const err = new Error('abort');
		err.name = 'AbortError';
		(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi
			.fn()
			.mockRejectedValue(err);
		(window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi.fn();
		expect(await pickSaveTarget('foo.md')).toBeNull();
	});

	it('passe le suggestedName', async () => {
		const picker = vi.fn().mockResolvedValue({ name: 'x' });
		(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = picker;
		(window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi.fn();
		await pickSaveTarget('mon-doc.md');
		expect(picker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: 'mon-doc.md' }));
	});
});

describe('writeHandle', () => {
	it('écrit le contenu via createWritable et close()', async () => {
		const write = vi.fn().mockResolvedValue(undefined);
		const close = vi.fn().mockResolvedValue(undefined);
		const handle = {
			createWritable: vi.fn().mockResolvedValue({ write, close })
		} as unknown as FileSystemFileHandle;
		await writeHandle(handle, 'bonjour');
		expect(write).toHaveBeenCalledWith('bonjour');
		expect(close).toHaveBeenCalled();
	});

	it('throw si createWritable est absent', async () => {
		const handle = {} as unknown as FileSystemFileHandle;
		await expect(writeHandle(handle, 'x')).rejects.toThrow(/createWritable/);
	});
});
