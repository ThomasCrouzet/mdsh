import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { notify } from './notify.svelte';
import { promptStore } from './prompt.svelte';
import type { FileItem } from './types';

// FSA est entièrement mocké : on teste la logique de synchronisation disque
// (flags FileItem, feedback notify, gardes mtime, gestion d'erreur par fichier),
// pas l'API File System Access native (absente de jsdom).
vi.mock('./fsa', () => ({
	isFSASupported: vi.fn(() => true),
	getHandle: vi.fn(),
	getPathLink: vi.fn(),
	requestPermission: vi.fn(),
	pickSaveTarget: vi.fn(),
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

vi.mock('./disk-tauri', () => ({
	tauriPickAndOpen: vi.fn(async () => ({ files: [], failed: 0 })),
	tauriPickSaveTarget: vi.fn(async () => null),
	tauriWritePath: vi.fn(async () => {}),
	tauriReadMeta: vi.fn(async () => null),
	tauriCheckPath: vi.fn(async () => 'ok'),
	tauriOpenAbsolutePaths: vi.fn(async () => ({ files: [], failed: 0 }))
}));

import * as fsa from './fsa';
import * as desktop from './desktop';
import * as diskTauri from './disk-tauri';
import {
	openFromDisk,
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

// jsdom n'implémente pas File.prototype.text() ; on fabrique un faux File doté
// d'un text() résolvant, plus lastModified/size contrôlables. Suffisant pour
// openFromDisk qui ne lit que name/text()/lastModified/size.
function fakeFile(
	name: string,
	content: string,
	over: { lastModified?: number; size?: number } = {}
): File {
	return {
		name,
		lastModified: over.lastModified ?? 0,
		size: over.size ?? content.length,
		text: () => Promise.resolve(content)
	} as unknown as File;
}

beforeEach(() => {
	notify.clear();
	vi.clearAllMocks();
	// Évite la pollution console des reportError attendus.
	vi.spyOn(console, 'error').mockImplementation(() => {});
	// Par défaut FSA est supportée, desktop non (réinitialisé après clearAllMocks).
	vi.mocked(fsa.isFSASupported).mockReturnValue(true);
	vi.mocked(desktop.isDesktop).mockReturnValue(false);
	vi.mocked(fsa.getPathLink).mockResolvedValue(null);
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

	it('retourne [] si FSA non supportée', async () => {
		vi.mocked(fsa.isFSASupported).mockReturnValue(false);
		const created = await openFromDisk(depsFor([]));
		expect(created).toEqual([]);
		expect(fsa.pickAndOpen).not.toHaveBeenCalled();
	});

	it('retourne [] si le picker ne renvoie rien (annulation)', async () => {
		vi.mocked(fsa.pickAndOpen).mockResolvedValue([]);
		const created = await openFromDisk(depsFor([]));
		expect(created).toEqual([]);
	});

	it('ouvre chaque fichier, marque le lien disque et persiste le handle', async () => {
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
		// Un handle persisté par fichier.
		expect(fsa.saveHandle).toHaveBeenCalledTimes(2);
		expect(fsa.saveHandle).toHaveBeenCalledWith('id-a.md', hA);
		// Aucun toast partiel si rien n'a échoué.
		expect(notify.toasts).toHaveLength(0);
	});

	it('continue malgré un fichier illisible et émet un toast info partiel', async () => {
		const good = fakeFile('good.md', 'ok');
		// Fichier dont .text() rejette → la lecture du contenu échoue.
		const bad = {
			name: 'bad.md',
			lastModified: 0,
			size: 0,
			text: vi.fn().mockRejectedValue(new Error('illisible'))
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
		// reportError a été appelé pour le fichier en échec.
		expect(console.error).toHaveBeenCalled();
		// Résumé partiel "N ouverts, M ignorés" via toast info.
		expect(notify.toasts.some((t) => t.level === 'info')).toBe(true);
	});

	it('échec de persistance du handle compte comme fichier ignoré', async () => {
		const f = fakeFile('x.md', 'ok');
		vi.mocked(fsa.pickAndOpen).mockResolvedValue([{ handle, file: f }]);
		vi.mocked(fsa.saveHandle).mockRejectedValue(new Error('IDB plein'));

		const store: FileItem[] = [];
		const created = await openFromDisk(depsFor(store));

		// onCreate a tourné mais l'échec de saveHandle a écarté le fichier de la
		// liste retournée. Pas de toast partiel car aucun fichier n'a réussi.
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

	it('retourne false si FSA non supportée', async () => {
		vi.mocked(fsa.isFSASupported).mockReturnValue(false);
		expect(await saveToDisk('a', deps)).toBe(false);
	});

	it('retourne false si le fichier est introuvable', async () => {
		const missing: DiskSyncDeps = { ...deps, getFile: () => undefined };
		expect(await saveToDisk('a', missing)).toBe(false);
	});

	it('handle existant + permission accordée : écrit, met à jour les flags et planifie un save', async () => {
		const written = new File(['contenu'], 'note.md');
		Object.defineProperty(written, 'lastModified', { value: 5555, configurable: true });
		const handleWithFile = {
			getFile: vi.fn().mockResolvedValue(written)
		} as unknown as FileSystemFileHandle;
		vi.mocked(fsa.getHandle).mockResolvedValue(handleWithFile);
		vi.mocked(fsa.requestPermission).mockResolvedValue(true);
		vi.mocked(fsa.writeHandle).mockResolvedValue(undefined);

		const ok = await saveToDisk('a', deps);

		expect(ok).toBe(true);
		expect(file.linkedToDisk).toBe(true);
		expect(file.brokenLink).toBe(false);
		expect(file.dirty).toBe(false);
		// La baseline anti-écrasement est rafraîchie après écriture.
		expect(file.diskLastModified).toBe(5555);
		expect(file.diskSize).toBe(written.size);
		expect(scheduleSave).toHaveBeenCalledWith('a');
		expect(notify.toasts.some((t) => t.level === 'success')).toBe(true);
	});

	it('handle existant + permission refusée : false, sans toast', async () => {
		vi.mocked(fsa.getHandle).mockResolvedValue(handle);
		vi.mocked(fsa.requestPermission).mockResolvedValue(false);
		expect(await saveToDisk('a', deps)).toBe(false);
		expect(notify.toasts).toHaveLength(0);
		expect(fsa.writeHandle).not.toHaveBeenCalled();
	});

	it("échec d'écriture : false, lien marqué cassé, toast erreur", async () => {
		vi.mocked(fsa.getHandle).mockResolvedValue(handle);
		vi.mocked(fsa.requestPermission).mockResolvedValue(true);
		vi.mocked(fsa.writeHandle).mockRejectedValue(new Error('disk fail'));
		const ok = await saveToDisk('a', deps);
		expect(ok).toBe(false);
		expect(file.brokenLink).toBe(true);
		expect(notify.toasts.some((t) => t.level === 'error')).toBe(true);
		expect(scheduleSave).not.toHaveBeenCalled();
	});

	it('aucun handle : ouvre un picker, persiste le handle puis écrit', async () => {
		const picked = { tag: 'picked' } as unknown as FileSystemFileHandle;
		const written = new File(['contenu'], 'note.md');
		Object.defineProperty(picked, 'getFile', {
			value: vi.fn().mockResolvedValue(written),
			configurable: true
		});
		vi.mocked(fsa.getHandle).mockResolvedValue(null);
		vi.mocked(fsa.pickSaveTarget).mockResolvedValue(picked);
		vi.mocked(fsa.saveHandle).mockResolvedValue(undefined);
		vi.mocked(fsa.writeHandle).mockResolvedValue(undefined);

		const ok = await saveToDisk('a', deps);

		expect(ok).toBe(true);
		expect(fsa.pickSaveTarget).toHaveBeenCalledWith('note.md');
		expect(fsa.saveHandle).toHaveBeenCalledWith('a', picked);
		expect(file.linkedToDisk).toBe(true);
	});

	it('aucun handle + picker annulé : false sans écriture', async () => {
		vi.mocked(fsa.getHandle).mockResolvedValue(null);
		vi.mocked(fsa.pickSaveTarget).mockResolvedValue(null);
		expect(await saveToDisk('a', deps)).toBe(false);
		expect(fsa.writeHandle).not.toHaveBeenCalled();
		expect(fsa.saveHandle).not.toHaveBeenCalled();
	});

	it('re-lecture impossible après écriture : invalide la baseline (undefined)', async () => {
		const getFile = vi.fn().mockRejectedValue(new Error('relecture KO'));
		const h = { getFile } as unknown as FileSystemFileHandle;
		vi.mocked(fsa.getHandle).mockResolvedValue(h);
		vi.mocked(fsa.requestPermission).mockResolvedValue(true);
		vi.mocked(fsa.writeHandle).mockResolvedValue(undefined);
		// file.diskLastModified undefined → pas de garde mtime, mais getFile post-write throw.
		const ok = await saveToDisk('a', deps);
		expect(ok).toBe(true);
		expect(file.diskLastModified).toBeUndefined();
		expect(file.diskSize).toBeUndefined();
	});

	describe('garde anti-écrasement (conflit mtime §C2)', () => {
		beforeEach(() => {
			// Fichier déjà lié avec une baseline disque connue.
			file = makeFile({ linkedToDisk: true, diskLastModified: 1000, diskSize: 7 });
			deps = { getFile: () => file, onCreate: () => file, scheduleSave };
		});

		it('disque divergent + confirmation : écrit', async () => {
			const onDisk = new File(['autre contenu disque'], 'note.md');
			Object.defineProperty(onDisk, 'lastModified', { value: 9999, configurable: true });
			const writtenAfter = new File(['contenu'], 'note.md');
			Object.defineProperty(writtenAfter, 'lastModified', { value: 12345, configurable: true });
			const getFile = vi
				.fn()
				.mockResolvedValueOnce(onDisk) // check anti-écrasement
				.mockResolvedValueOnce(writtenAfter); // rafraîchissement baseline
			const h = { getFile } as unknown as FileSystemFileHandle;
			vi.mocked(fsa.getHandle).mockResolvedValue(h);
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

		it('disque divergent + refus : false, toast info "annulé", pas d\'écriture', async () => {
			const onDisk = new File(['autre'], 'note.md');
			Object.defineProperty(onDisk, 'lastModified', { value: 9999, configurable: true });
			const h = { getFile: vi.fn().mockResolvedValue(onDisk) } as unknown as FileSystemFileHandle;
			vi.mocked(fsa.getHandle).mockResolvedValue(h);
			vi.mocked(fsa.requestPermission).mockResolvedValue(true);
			const confirmSpy = vi.spyOn(promptStore, 'confirm').mockResolvedValue(false);

			const ok = await saveToDisk('a', deps);

			expect(ok).toBe(false);
			expect(fsa.writeHandle).not.toHaveBeenCalled();
			expect(notify.toasts.some((t) => t.level === 'info')).toBe(true);
			confirmSpy.mockRestore();
		});

		it('divergence par taille seule déclenche aussi la confirmation', async () => {
			// mtime identique mais taille différente → diverged.
			const onDisk = new File(['taille differente'], 'note.md');
			Object.defineProperty(onDisk, 'lastModified', { value: 1000, configurable: true });
			const h = { getFile: vi.fn().mockResolvedValue(onDisk) } as unknown as FileSystemFileHandle;
			vi.mocked(fsa.getHandle).mockResolvedValue(h);
			vi.mocked(fsa.requestPermission).mockResolvedValue(true);
			const confirmSpy = vi.spyOn(promptStore, 'confirm').mockResolvedValue(false);

			await saveToDisk('a', deps);
			expect(confirmSpy).toHaveBeenCalled();
			confirmSpy.mockRestore();
		});

		it('disque inchangé : pas de confirmation, écrit directement', async () => {
			const onDisk = new File(['1234567'], 'note.md'); // 7 octets, mtime 1000 = baseline
			Object.defineProperty(onDisk, 'lastModified', { value: 1000, configurable: true });
			const writtenAfter = new File(['contenu'], 'note.md');
			Object.defineProperty(writtenAfter, 'lastModified', { value: 2000, configurable: true });
			const getFile = vi.fn().mockResolvedValueOnce(onDisk).mockResolvedValueOnce(writtenAfter);
			const h = { getFile } as unknown as FileSystemFileHandle;
			vi.mocked(fsa.getHandle).mockResolvedValue(h);
			vi.mocked(fsa.requestPermission).mockResolvedValue(true);
			vi.mocked(fsa.writeHandle).mockResolvedValue(undefined);
			const confirmSpy = vi.spyOn(promptStore, 'confirm');

			const ok = await saveToDisk('a', deps);

			expect(ok).toBe(true);
			expect(confirmSpy).not.toHaveBeenCalled();
			confirmSpy.mockRestore();
		});

		it("lecture impossible pendant le check : log puis poursuite de l'écriture", async () => {
			const writtenAfter = new File(['contenu'], 'note.md');
			Object.defineProperty(writtenAfter, 'lastModified', { value: 3000, configurable: true });
			const getFile = vi
				.fn()
				.mockRejectedValueOnce(new Error('lecture check KO')) // check anti-écrasement
				.mockResolvedValueOnce(writtenAfter); // rafraîchissement baseline post-write
			const h = { getFile } as unknown as FileSystemFileHandle;
			vi.mocked(fsa.getHandle).mockResolvedValue(h);
			vi.mocked(fsa.requestPermission).mockResolvedValue(true);
			vi.mocked(fsa.writeHandle).mockResolvedValue(undefined);
			const confirmSpy = vi.spyOn(promptStore, 'confirm');

			const ok = await saveToDisk('a', deps);

			// Lecture du check impossible → on logge et on laisse l'écriture suivre.
			expect(confirmSpy).not.toHaveBeenCalled();
			expect(console.error).toHaveBeenCalled();
			expect(ok).toBe(true);
			confirmSpy.mockRestore();
		});
	});
});

describe('unlinkFromDisk', () => {
	it('supprime le handle puis délie le fichier et planifie un save', async () => {
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

	it('supprime quand même le handle orphelin si le fichier est absent du store', async () => {
		const scheduleSave = vi.fn();
		const deps: DiskSyncDeps = {
			getFile: () => undefined,
			onCreate: () => makeFile(),
			scheduleSave
		};
		vi.mocked(fsa.deleteHandle).mockResolvedValue(undefined);

		await unlinkFromDisk('orphan', deps);

		// Le handle IDB est retiré en premier (garantie pour DiskLinksPanel)…
		expect(fsa.deleteHandle).toHaveBeenCalledWith('orphan');
		// …mais aucun scheduleSave car aucun FileItem à persister.
		expect(scheduleSave).not.toHaveBeenCalled();
	});
});

describe('isDiskLinkingAvailable', () => {
	it('vrai si FSA est supportée', () => {
		vi.mocked(fsa.isFSASupported).mockReturnValue(true);
		vi.mocked(desktop.isDesktop).mockReturnValue(false);
		expect(isDiskLinkingAvailable()).toBe(true);
	});

	it('vrai sur le shell desktop même sans FSA', () => {
		vi.mocked(fsa.isFSASupported).mockReturnValue(false);
		vi.mocked(desktop.isDesktop).mockReturnValue(true);
		expect(isDiskLinkingAvailable()).toBe(true);
	});

	it('faux sans FSA ni desktop', () => {
		vi.mocked(fsa.isFSASupported).mockReturnValue(false);
		vi.mocked(desktop.isDesktop).mockReturnValue(false);
		expect(isDiskLinkingAvailable()).toBe(false);
	});
});

describe('openFromDisk desktop path backend', () => {
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

	it('utilise le backend Tauri et persiste un path link', async () => {
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
		expect(fsa.savePathLink).toHaveBeenCalledWith('id-note.md', {
			kind: 'path',
			path: '/tmp/note.md'
		});
		expect(fsa.pickAndOpen).not.toHaveBeenCalled();
	});

	it('openPathsFromDesktop lie les chemins argv', async () => {
		vi.mocked(desktop.isDesktop).mockReturnValue(true);
		vi.mocked(diskTauri.tauriOpenAbsolutePaths).mockResolvedValue({
			files: [
				{
					name: 'from-argv.md',
					content: 'x',
					path: '/Users/me/from-argv.md',
					lastModified: 1,
					size: 1,
					link: { kind: 'path', path: '/Users/me/from-argv.md' }
				}
			],
			failed: 0
		});
		const store: FileItem[] = [];
		const created = await openPathsFromDesktop(['/Users/me/from-argv.md'], depsFor(store));
		expect(created).toHaveLength(1);
		expect(fsa.savePathLink).toHaveBeenCalled();
	});
});

describe('saveToDisk desktop path backend', () => {
	function desktopDeps(file: FileItem) {
		const scheduleSave = vi.fn();
		const deps: DiskSyncDeps = { getFile: () => file, onCreate: () => file, scheduleSave };
		vi.mocked(desktop.isDesktop).mockReturnValue(true);
		vi.mocked(fsa.isFSASupported).mockReturnValue(false);
		return { deps, scheduleSave };
	}

	it('écrit via tauriWritePath et met à jour mtime', async () => {
		const file = makeFile({
			content: 'new',
			linkedToDisk: true,
			diskLastModified: 10,
			diskSize: 3
		});
		const { deps, scheduleSave } = desktopDeps(file);
		vi.mocked(fsa.getPathLink).mockResolvedValue({ kind: 'path', path: '/tmp/note.md' });
		vi.mocked(diskTauri.tauriReadMeta).mockResolvedValue({ lastModified: 10, size: 3 });
		vi.mocked(diskTauri.tauriWritePath).mockResolvedValue(undefined);
		vi.mocked(diskTauri.tauriReadMeta)
			.mockResolvedValueOnce({ lastModified: 10, size: 3 })
			.mockResolvedValueOnce({ lastModified: 99, size: 3 });

		const ok = await saveToDisk('a', deps);
		expect(ok).toBe(true);
		expect(diskTauri.tauriWritePath).toHaveBeenCalledWith('/tmp/note.md', 'new');
		expect(file.dirty).toBe(false);
		expect(file.diskLastModified).toBe(99);
		expect(scheduleSave).toHaveBeenCalledWith('a');
	});

	it('retourne false quand le sélecteur natif est annulé', async () => {
		const file = makeFile();
		const { deps } = desktopDeps(file);
		vi.mocked(fsa.getPathLink).mockResolvedValue(null);
		vi.mocked(diskTauri.tauriPickSaveTarget).mockResolvedValue(null);

		expect(await saveToDisk('a', deps)).toBe(false);
		expect(diskTauri.tauriWritePath).not.toHaveBeenCalled();
	});

	it('persiste une nouvelle cible et invalide une métadonnée absente', async () => {
		const file = makeFile();
		const { deps, scheduleSave } = desktopDeps(file);
		const pathLink = { kind: 'path' as const, path: '/tmp/new.md' };
		vi.mocked(fsa.getPathLink).mockResolvedValue(null);
		vi.mocked(diskTauri.tauriPickSaveTarget).mockResolvedValue(pathLink);
		vi.mocked(diskTauri.tauriWritePath).mockResolvedValue(undefined);
		vi.mocked(diskTauri.tauriReadMeta).mockResolvedValue(null);

		expect(await saveToDisk('a', deps)).toBe(true);
		expect(fsa.savePathLink).toHaveBeenCalledWith('a', pathLink);
		expect(file.linkedToDisk).toBe(true);
		expect(file.diskLastModified).toBeUndefined();
		expect(file.diskSize).toBeUndefined();
		expect(scheduleSave).toHaveBeenCalledWith('a');
	});

	it('annule une écriture si le fichier disque a divergé', async () => {
		const file = makeFile({ diskLastModified: 10, diskSize: 3 });
		const { deps } = desktopDeps(file);
		vi.mocked(fsa.getPathLink).mockResolvedValue({ kind: 'path', path: '/tmp/note.md' });
		vi.mocked(diskTauri.tauriReadMeta).mockResolvedValue({ lastModified: 20, size: 3 });
		const confirmSpy = vi.spyOn(promptStore, 'confirm').mockResolvedValue(false);

		expect(await saveToDisk('a', deps)).toBe(false);
		expect(diskTauri.tauriWritePath).not.toHaveBeenCalled();
		expect(notify.toasts.some((toast) => toast.level === 'info')).toBe(true);
		confirmSpy.mockRestore();
	});

	it("signale une erreur d'écriture native et marque le lien cassé", async () => {
		const file = makeFile();
		const { deps, scheduleSave } = desktopDeps(file);
		vi.mocked(fsa.getPathLink).mockResolvedValue({ kind: 'path', path: '/tmp/note.md' });
		vi.mocked(diskTauri.tauriWritePath).mockRejectedValue(new Error('disk full'));

		expect(await saveToDisk('a', deps)).toBe(false);
		expect(file.brokenLink).toBe(true);
		expect(notify.toasts.some((toast) => toast.level === 'error')).toBe(true);
		expect(scheduleSave).not.toHaveBeenCalled();
	});

	it('poursuit si les métadonnées natives sont illisibles et invalide la référence', async () => {
		const file = makeFile({ diskLastModified: 10, diskSize: 3 });
		const { deps } = desktopDeps(file);
		vi.mocked(fsa.getPathLink).mockResolvedValue({ kind: 'path', path: '/tmp/note.md' });
		vi.mocked(diskTauri.tauriReadMeta)
			.mockRejectedValueOnce(new Error('stat before failed'))
			.mockRejectedValueOnce(new Error('stat after failed'));
		vi.mocked(diskTauri.tauriWritePath).mockResolvedValue(undefined);

		expect(await saveToDisk('a', deps)).toBe(true);
		expect(console.error).toHaveBeenCalled();
		expect(file.diskLastModified).toBeUndefined();
		expect(file.diskSize).toBeUndefined();
	});
});

describe('refreshBrokenLinks', () => {
	it('no-op si FSA non supportée et hors desktop', async () => {
		vi.mocked(fsa.isFSASupported).mockReturnValue(false);
		vi.mocked(desktop.isDesktop).mockReturnValue(false);
		const files = [makeFile({ id: 'f1', linkedToDisk: true })];
		await refreshBrokenLinks(files, () => files[0]);
		// getHandle/checkHandle ne sont jamais appelés.
		expect(fsa.getHandle).not.toHaveBeenCalled();
		expect(fsa.checkHandle).not.toHaveBeenCalled();
	});

	it('marque brokenLink=true quand checkHandle renvoie "broken"', async () => {
		const f = makeFile({ id: 'f1', linkedToDisk: true });
		vi.mocked(fsa.getHandle).mockResolvedValue(handle);
		vi.mocked(fsa.checkHandle).mockResolvedValue('broken');
		await refreshBrokenLinks([f], (id) => (id === 'f1' ? f : undefined));
		expect(f.brokenLink).toBe(true);
		expect(f.linkedToDisk).toBe(true); // handle présent → on garde le lien
	});

	it('handle absent : brokenLink=true ET linkedToDisk repassé à false', async () => {
		const f = makeFile({ id: 'f1', linkedToDisk: true });
		vi.mocked(fsa.getHandle).mockResolvedValue(null);
		await refreshBrokenLinks([f], (id) => (id === 'f1' ? f : undefined));
		expect(f.brokenLink).toBe(true);
		expect(f.linkedToDisk).toBe(false);
		// checkHandle non appelé puisqu'il n'y a pas de handle.
		expect(fsa.checkHandle).not.toHaveBeenCalled();
	});

	it('lien OK : brokenLink remis à false, linkedToDisk conservé', async () => {
		const f = makeFile({ id: 'f1', linkedToDisk: true, brokenLink: true });
		vi.mocked(fsa.getHandle).mockResolvedValue(handle);
		vi.mocked(fsa.checkHandle).mockResolvedValue('ok');
		await refreshBrokenLinks([f], (id) => (id === 'f1' ? f : undefined));
		expect(f.brokenLink).toBe(false);
		expect(f.linkedToDisk).toBe(true);
	});

	it('ignore les fichiers non liés au disque', async () => {
		const f = makeFile({ id: 'f1', linkedToDisk: false });
		await refreshBrokenLinks([f], () => f);
		expect(fsa.getHandle).not.toHaveBeenCalled();
	});

	it('saute silencieusement un update dont le FileItem a disparu du store', async () => {
		const f = makeFile({ id: 'f1', linkedToDisk: true });
		vi.mocked(fsa.getHandle).mockResolvedValue(handle);
		vi.mocked(fsa.checkHandle).mockResolvedValue('broken');
		// getFileMutable ne retrouve plus le fichier (supprimé entre-temps).
		await expect(refreshBrokenLinks([f], () => undefined)).resolves.toBeUndefined();
		// L'objet d'origine n'est pas muté car le lookup renvoie undefined.
		expect(f.brokenLink).toBeUndefined();
	});
});
