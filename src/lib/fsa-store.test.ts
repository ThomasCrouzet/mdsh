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

// IDB dédiée aux handles (mdsh-fs) - isolée de Dexie (mdsh). On la purge entre
// chaque test pour repartir d'un store vide. La connexion mise en cache au
// niveau module est ré-ouverte automatiquement après suppression de la base.
async function wipeHandleDB() {
	await new Promise<void>((resolve) => {
		const req = indexedDB.deleteDatabase('mdsh-fs');
		req.onsuccess = () => resolve();
		req.onerror = () => resolve();
		req.onblocked = () => resolve();
	});
}

// Réinitialise les globals FSA exposés sur window pour éviter les fuites d'état
// d'un test à l'autre.
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
	it('isFSASupported faux quand aucune API exposée', () => {
		expect(isFSASupported()).toBe(false);
	});

	it('isFSASupported vrai quand open + save pickers présents', () => {
		(window as unknown as { showOpenFilePicker: () => void }).showOpenFilePicker = () => {};
		(window as unknown as { showSaveFilePicker: () => void }).showSaveFilePicker = () => {};
		expect(isFSASupported()).toBe(true);
	});

	it('isFSASupported faux si seul le save picker est présent', () => {
		(window as unknown as { showSaveFilePicker: () => void }).showSaveFilePicker = () => {};
		expect(isFSASupported()).toBe(false);
	});

	it('isDirectoryPickerSupported vrai/faux selon la présence du picker', () => {
		expect(isDirectoryPickerSupported()).toBe(false);
		(window as unknown as { showDirectoryPicker: () => void }).showDirectoryPicker = () => {};
		expect(isDirectoryPickerSupported()).toBe(true);
	});
});

describe('saveHandle / getHandle / deleteHandle (persistance IDB)', () => {
	it('persiste un handle puis le relit par id (round-trip)', async () => {
		const handle = { name: 'doc.md' } as unknown as FileSystemFileHandle;
		await saveHandle('round-1', handle);
		const got = await getHandle('round-1');
		expect((got as unknown as { name: string }).name).toBe('doc.md');
	});

	it('getHandle retourne null pour un id absent', async () => {
		expect(await getHandle('absent')).toBeNull();
	});

	it('saveHandle écrase la valeur existante (même clé)', async () => {
		await saveHandle('dup', { name: 'v1' } as unknown as FileSystemFileHandle);
		await saveHandle('dup', { name: 'v2' } as unknown as FileSystemFileHandle);
		expect((await getHandle('dup')) as unknown as { name: string }).toMatchObject({ name: 'v2' });
	});

	it('deleteHandle supprime une entrée existante', async () => {
		await saveHandle('rm', { name: 'rm.md' } as unknown as FileSystemFileHandle);
		expect(await getHandle('rm')).not.toBeNull();
		await deleteHandle('rm');
		expect(await getHandle('rm')).toBeNull();
	});

	it('deleteHandle sur id inexistant résout sans throw', async () => {
		await expect(deleteHandle('jamais-vu')).resolves.toBeUndefined();
	});

	it('réutilise la connexion IDB en cache sur les appels suivants', async () => {
		// Premier appel ouvre la connexion, les suivants la réutilisent (pas
		// d'assertion directe sur le cache module-level, mais on vérifie que des
		// appels enchaînés restent cohérents).
		await saveHandle('c1', { name: 'c1' } as unknown as FileSystemFileHandle);
		await saveHandle('c2', { name: 'c2' } as unknown as FileSystemFileHandle);
		expect((await getHandle('c1')) as unknown as { name: string }).toMatchObject({ name: 'c1' });
		expect((await getHandle('c2')) as unknown as { name: string }).toMatchObject({ name: 'c2' });
	});
});

describe('listHandles', () => {
	it('retourne [] quand aucun handle stocké', async () => {
		expect(await listHandles()).toEqual([]);
	});

	it('liste tous les handles stockés avec leur id', async () => {
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

	it('reflète une suppression', async () => {
		await saveHandle('keep', { name: 'keep' } as unknown as FileSystemFileHandle);
		await saveHandle('drop', { name: 'drop' } as unknown as FileSystemFileHandle);
		await deleteHandle('drop');
		const ids = (await listHandles()).map((e) => e.id);
		expect(ids).toEqual(['keep']);
	});

	it('fail-soft : retourne [] si IDB est indisponible', async () => {
		// On simule une indisponibilité d'IndexedDB : openHandleDB rejette,
		// listHandles doit avaler l'erreur et renvoyer [] plutôt que throw.
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
	it('retourne false si le handle ne supporte pas les permissions', async () => {
		expect(await requestPermission({} as unknown as FileSystemFileHandle)).toBe(false);
	});

	it('retourne true si queryPermission accorde déjà (pas de requête)', async () => {
		const request = vi.fn();
		const handle = {
			queryPermission: vi.fn().mockResolvedValue('granted'),
			requestPermission: request
		} as unknown as FileSystemFileHandle;
		expect(await requestPermission(handle, 'readwrite')).toBe(true);
		expect(request).not.toHaveBeenCalled();
	});

	it('demande la permission si query renvoie "prompt" puis accorde', async () => {
		const handle = {
			queryPermission: vi.fn().mockResolvedValue('prompt'),
			requestPermission: vi.fn().mockResolvedValue('granted')
		} as unknown as FileSystemFileHandle;
		expect(await requestPermission(handle)).toBe(true);
	});

	it('retourne false si la requête est refusée', async () => {
		const handle = {
			queryPermission: vi.fn().mockResolvedValue('prompt'),
			requestPermission: vi.fn().mockResolvedValue('denied')
		} as unknown as FileSystemFileHandle;
		expect(await requestPermission(handle)).toBe(false);
	});

	it('défaut mode = readwrite', async () => {
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
	it('retourne [] si FSA non supportée', async () => {
		expect(await pickAndOpen()).toEqual([]);
	});

	it('résout les handles et lit chaque fichier', async () => {
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

	it('retourne [] sur annulation utilisateur (AbortError)', async () => {
		const err = Object.assign(new Error('abort'), { name: 'AbortError' });
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
		expect(await pickSaveTarget('x.md')).toBeNull();
	});

	it('retourne le handle choisi', async () => {
		const fake = { name: 'out.md' } as unknown as FileSystemFileHandle;
		(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi
			.fn()
			.mockResolvedValue(fake);
		(window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi.fn();
		expect(await pickSaveTarget('out.md')).toBe(fake);
	});

	it('retourne null sur annulation (AbortError)', async () => {
		const err = Object.assign(new Error('abort'), { name: 'AbortError' });
		(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi
			.fn()
			.mockRejectedValue(err);
		(window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi.fn();
		expect(await pickSaveTarget('out.md')).toBeNull();
	});

	it('propage les autres erreurs', async () => {
		(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi
			.fn()
			.mockRejectedValue(new Error('disk full'));
		(window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi.fn();
		await expect(pickSaveTarget('out.md')).rejects.toThrow('disk full');
	});

	it('transmet le suggestedName au picker', async () => {
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
	it('écrit le contenu via createWritable puis close', async () => {
		const write = vi.fn().mockResolvedValue(undefined);
		const close = vi.fn().mockResolvedValue(undefined);
		const handle = {
			createWritable: vi.fn().mockResolvedValue({ write, close })
		} as unknown as FileSystemFileHandle;
		await writeHandle(handle, 'salut');
		expect(write).toHaveBeenCalledWith('salut');
		expect(close).toHaveBeenCalled();
	});

	it('throw si createWritable absent', async () => {
		await expect(writeHandle({} as unknown as FileSystemFileHandle, 'x')).rejects.toThrow(
			/createWritable/
		);
	});
});

describe('checkHandle', () => {
	it("retourne 'broken' si le handle n'a pas queryPermission", async () => {
		expect(await checkHandle({} as unknown as FileSystemFileHandle)).toBe('broken');
	});

	it("retourne 'ok' si permission accordée et getFile résout", async () => {
		const handle = {
			queryPermission: vi.fn().mockResolvedValue('granted'),
			getFile: vi.fn().mockResolvedValue(new File(['x'], 'x.md'))
		} as unknown as FileSystemFileHandle;
		expect(await checkHandle(handle)).toBe('ok');
	});

	it("retourne 'permission-needed' si permission révoquée (prompt)", async () => {
		const getFile = vi.fn();
		const handle = {
			queryPermission: vi.fn().mockResolvedValue('prompt'),
			getFile
		} as unknown as FileSystemFileHandle;
		expect(await checkHandle(handle)).toBe('permission-needed');
		// On ne tente pas de lire le fichier si la permission n'est pas accordée.
		expect(getFile).not.toHaveBeenCalled();
	});

	it("retourne 'broken' si queryPermission throw", async () => {
		const handle = {
			queryPermission: vi.fn().mockRejectedValue(new Error('revoked')),
			getFile: vi.fn()
		} as unknown as FileSystemFileHandle;
		expect(await checkHandle(handle)).toBe('broken');
	});

	it("retourne 'broken' si getFile throw (fichier supprimé après autorisation)", async () => {
		const handle = {
			queryPermission: vi.fn().mockResolvedValue('granted'),
			getFile: vi
				.fn()
				.mockRejectedValue(Object.assign(new Error('gone'), { name: 'NotFoundError' }))
		} as unknown as FileSystemFileHandle;
		expect(await checkHandle(handle)).toBe('broken');
	});
});
