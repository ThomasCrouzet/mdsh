import { describe, it, expect, vi } from 'vitest';
import type { FileItem } from './types';
import { computeBrokenLinks, canCheckBrokenLinks } from './broken-links';

// Helper pour créer un FileItem minimal
function makeFile(overrides: Partial<FileItem> & { id: string }): FileItem {
	return {
		name: 'test.md',
		content: '',
		createdAt: 0,
		updatedAt: 0,
		dirty: false,
		linkedToDisk: false,
		...overrides
	};
}

describe('computeBrokenLinks', () => {
	it('ignore les fichiers non liés au disque (linkedToDisk false)', async () => {
		const files = [makeFile({ id: 'f1', linkedToDisk: false })];
		const getHandleFn = vi.fn().mockResolvedValue(null);
		const checkHandleFn = vi.fn();

		const updates = await computeBrokenLinks(files, { getHandleFn, checkHandleFn });

		expect(updates).toHaveLength(0);
		expect(getHandleFn).not.toHaveBeenCalled();
	});

	it('ignore les fichiers sans linkedToDisk défini (undefined)', async () => {
		const files = [makeFile({ id: 'f1' })]; // linkedToDisk non défini
		const getHandleFn = vi.fn().mockResolvedValue(null);
		const checkHandleFn = vi.fn();

		const updates = await computeBrokenLinks(files, { getHandleFn, checkHandleFn });

		expect(updates).toHaveLength(0);
	});

	it('handle absent → brokenLink: true, handleMissing: true', async () => {
		const files = [makeFile({ id: 'f1', linkedToDisk: true })];
		const getHandleFn = vi.fn().mockResolvedValue(null); // handle introuvable en IDB
		const checkHandleFn = vi.fn();

		const updates = await computeBrokenLinks(files, { getHandleFn, checkHandleFn });

		expect(updates).toHaveLength(1);
		expect(updates[0]).toEqual({ id: 'f1', brokenLink: true, handleMissing: true });
		expect(checkHandleFn).not.toHaveBeenCalled();
	});

	it("handle présent mais checkHandleFn retourne 'broken' → brokenLink: true, handleMissing: false", async () => {
		const fakeHandle = {} as FileSystemFileHandle;
		const files = [makeFile({ id: 'f2', linkedToDisk: true })];
		const getHandleFn = vi.fn().mockResolvedValue(fakeHandle);
		const checkHandleFn = vi.fn().mockResolvedValue('broken');

		const updates = await computeBrokenLinks(files, { getHandleFn, checkHandleFn });

		expect(updates).toHaveLength(1);
		expect(updates[0]).toEqual({ id: 'f2', brokenLink: true, handleMissing: false });
	});

	it("handle présent et checkHandleFn retourne 'ok' → brokenLink: false, handleMissing: false", async () => {
		const fakeHandle = {} as FileSystemFileHandle;
		const files = [makeFile({ id: 'f3', linkedToDisk: true })];
		const getHandleFn = vi.fn().mockResolvedValue(fakeHandle);
		const checkHandleFn = vi.fn().mockResolvedValue('ok');

		const updates = await computeBrokenLinks(files, { getHandleFn, checkHandleFn });

		expect(updates).toHaveLength(1);
		expect(updates[0]).toEqual({ id: 'f3', brokenLink: false, handleMissing: false });
	});

	it("handle présent et checkHandleFn retourne 'permission-needed' → brokenLink: false (pas 'broken')", async () => {
		const fakeHandle = {} as FileSystemFileHandle;
		const files = [makeFile({ id: 'f4', linkedToDisk: true })];
		const getHandleFn = vi.fn().mockResolvedValue(fakeHandle);
		// 'permission-needed' n'est pas 'broken' → brokenLink doit être false
		const checkHandleFn = vi.fn().mockResolvedValue('permission-needed');

		const updates = await computeBrokenLinks(files, { getHandleFn, checkHandleFn });

		expect(updates).toHaveLength(1);
		expect(updates[0]!.brokenLink).toBe(false);
		expect(updates[0]!.handleMissing).toBe(false);
	});

	it('traite plusieurs fichiers en parallèle et filtre correctement', async () => {
		const fakeHandle = {} as FileSystemFileHandle;
		const files = [
			makeFile({ id: 'linked-ok', linkedToDisk: true }),
			makeFile({ id: 'not-linked', linkedToDisk: false }),
			makeFile({ id: 'linked-missing', linkedToDisk: true })
		];

		const getHandleFn = vi.fn().mockImplementation((id: string) => {
			if (id === 'linked-ok') return Promise.resolve(fakeHandle);
			if (id === 'linked-missing') return Promise.resolve(null);
			return Promise.resolve(null);
		});
		const checkHandleFn = vi.fn().mockResolvedValue('ok');

		const updates = await computeBrokenLinks(files, { getHandleFn, checkHandleFn });

		// Seuls les 2 fichiers linkedToDisk sont vérifiés
		expect(updates).toHaveLength(2);
		const ids = updates.map((u) => u.id);
		expect(ids).toContain('linked-ok');
		expect(ids).toContain('linked-missing');
		expect(ids).not.toContain('not-linked');
	});

	it('retourne un tableau vide si aucun fichier linkedToDisk', async () => {
		const files = [
			makeFile({ id: 'a', linkedToDisk: false }),
			makeFile({ id: 'b', linkedToDisk: false })
		];
		const getHandleFn = vi.fn();
		const checkHandleFn = vi.fn();

		const updates = await computeBrokenLinks(files, { getHandleFn, checkHandleFn });

		expect(updates).toHaveLength(0);
	});

	it('retourne un tableau vide sur liste de fichiers vide', async () => {
		const updates = await computeBrokenLinks([], {});
		expect(updates).toHaveLength(0);
	});
});

describe('canCheckBrokenLinks', () => {
	it('retourne un booléen', () => {
		const result = canCheckBrokenLinks();
		expect(typeof result).toBe('boolean');
	});

	it('retourne false dans jsdom (showOpenFilePicker absent)', () => {
		// jsdom ne dispose pas de l'API File System Access
		expect(canCheckBrokenLinks()).toBe(false);
	});
});
