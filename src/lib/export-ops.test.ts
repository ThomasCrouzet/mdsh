import { describe, it, expect, beforeEach, vi } from 'vitest';
import { notify } from './notify.svelte';
import type { FileItem } from './types';
import { promptStore } from './prompt.svelte';
import { MediaPreparationError } from './render/image-media';

// On teste l'orchestration du feedback (notify), pas le rendu réel : les
// services d'export et le spinner sont mockés.
vi.mock('./services/export', () => ({
	exportMarkdown: vi.fn(),
	exportHTML: vi.fn(),
	exportPDF: vi.fn(),
	exportZip: vi.fn()
}));
vi.mock('./spinner.svelte', () => ({
	spinnerStore: { show: () => () => {} }
}));

import * as services from './services/export';
import {
	exportHTML,
	exportPDF,
	exportAllZip,
	exportSelectionZip,
	exportMarkdown
} from './export-ops';

function file(id: string): FileItem {
	return {
		id,
		name: `${id}.md`,
		content: 'x',
		createdAt: 0,
		updatedAt: 0,
		dirty: true,
		linkedToDisk: false
	};
}
const deps = {
	getFiles: () => [file('a'), file('b')] as readonly FileItem[],
	scheduleSave: () => {}
};

describe('export-ops - feedback notify (§J3)', () => {
	beforeEach(() => {
		notify.clear();
		vi.clearAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	it('exportHTML : toast succès', async () => {
		vi.mocked(services.exportHTML).mockResolvedValue(true);
		await exportHTML('a', deps);
		expect(notify.toasts.some((t) => t.level === 'success')).toBe(true);
	});

	it('exportHTML : toast erreur si le service échoue', async () => {
		vi.mocked(services.exportHTML).mockRejectedValue(new Error('boom'));
		await exportHTML('a', deps);
		expect(notify.toasts.some((t) => t.level === 'error')).toBe(true);
	});

	it('exportPDF : toast succès', async () => {
		vi.mocked(services.exportPDF).mockResolvedValue(undefined);
		await exportPDF('a', deps);
		expect(notify.toasts.some((t) => t.level === 'success')).toBe(true);
	});

	it('exportPDF : toast erreur si le service échoue', async () => {
		vi.mocked(services.exportPDF).mockRejectedValue(new Error('boom'));
		await exportPDF('a', deps);
		expect(notify.toasts.some((t) => t.level === 'error')).toBe(true);
	});

	it('exportAllZip : succès annonçant le nombre de fichiers', async () => {
		vi.mocked(services.exportZip).mockResolvedValue(true);
		await exportAllZip(deps);
		const ok = notify.toasts.find((t) => t.level === 'success');
		expect(ok?.message).toContain('2');
	});

	it('exportAllZip : toast erreur si le service échoue', async () => {
		vi.mocked(services.exportZip).mockRejectedValue(new Error('boom'));
		await exportAllZip(deps);
		expect(notify.toasts.some((t) => t.level === 'error')).toBe(true);
	});

	it('exportSelectionZip : succès sur une sélection', async () => {
		vi.mocked(services.exportZip).mockResolvedValue(true);
		await exportSelectionZip(new Set(['a']), deps);
		expect(notify.toasts.some((t) => t.level === 'success')).toBe(true);
	});

	it('exportSelectionZip : no-op si sélection vide', async () => {
		await exportSelectionZip(new Set(), deps);
		expect(services.exportZip).not.toHaveBeenCalled();
		expect(notify.toasts).toHaveLength(0);
	});

	it('exportSelectionZip : no-op si ids hors corpus', async () => {
		await exportSelectionZip(new Set(['missing']), deps);
		expect(services.exportZip).not.toHaveBeenCalled();
	});

	it('exportAllZip : no-op si aucun fichier', async () => {
		const emptyDeps = { getFiles: () => [] as readonly FileItem[], scheduleSave: () => {} };
		await exportAllZip(emptyDeps);
		expect(services.exportZip).not.toHaveBeenCalled();
	});

	it('exportHTML : no-op si id inconnu', async () => {
		await exportHTML('missing', deps);
		expect(services.exportHTML).not.toHaveBeenCalled();
	});

	it('exportMarkdown : no-op si id inconnu', async () => {
		await exportMarkdown('missing', deps);
		expect(services.exportMarkdown).not.toHaveBeenCalled();
	});

	it('exportMarkdown : annulation desktop ne clear pas dirty ni ne toast', async () => {
		const files = [file('a')];
		const scheduleSave = vi.fn();
		const localDeps = {
			getFiles: () => files as readonly FileItem[],
			scheduleSave
		};
		vi.mocked(services.exportMarkdown).mockResolvedValue(false);
		await exportMarkdown('a', localDeps);
		expect(files[0]!.dirty).toBe(true);
		expect(scheduleSave).not.toHaveBeenCalled();
		expect(notify.toasts).toHaveLength(0);
	});

	it('exportMarkdown : succès clear dirty et scheduleSave', async () => {
		const files = [file('a')];
		const scheduleSave = vi.fn();
		const localDeps = {
			getFiles: () => files as readonly FileItem[],
			scheduleSave
		};
		vi.mocked(services.exportMarkdown).mockResolvedValue(true);
		await exportMarkdown('a', localDeps);
		expect(files[0]!.dirty).toBe(false);
		expect(scheduleSave).toHaveBeenCalledWith('a');
	});

	it('exportHTML : annulation desktop ne toast pas succès', async () => {
		vi.mocked(services.exportHTML).mockResolvedValue(false);
		await exportHTML('a', deps);
		expect(notify.toasts.some((t) => t.level === 'success')).toBe(false);
	});

	it('demande le consentement avant de relancer un export avec accès réseau', async () => {
		vi.spyOn(promptStore, 'confirm').mockResolvedValue(true);
		vi.mocked(services.exportHTML)
			.mockRejectedValueOnce(
				new MediaPreparationError([{ source: 'https://images.example/a.png', reason: 'blocked' }])
			)
			.mockResolvedValueOnce(true);
		await exportHTML('a', deps);
		expect(promptStore.confirm).toHaveBeenCalledOnce();
		expect(services.exportHTML).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a' }), {
			allowNetworkImages: true
		});
	});

	it('une annulation du consentement n’exporte rien et n’annonce aucun succès', async () => {
		vi.spyOn(promptStore, 'confirm').mockResolvedValue(false);
		vi.mocked(services.exportPDF).mockRejectedValue(
			new MediaPreparationError([{ source: 'relative.png', reason: 'blocked' }])
		);
		await exportPDF('a', deps);
		expect(services.exportPDF).toHaveBeenCalledOnce();
		expect(notify.toasts.some((toast) => toast.level === 'success')).toBe(false);
	});

	it('ne marque pas une saisie concurrente comme exportée', async () => {
		const files = [file('a')];
		let finish: (value: boolean) => void = () => {};
		vi.mocked(services.exportMarkdown).mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				})
		);
		const scheduleSave = vi.fn();
		const pending = exportMarkdown('a', { getFiles: () => files, scheduleSave });
		files[0]!.content = 'nouvelle saisie';
		finish(true);
		await pending;
		expect(files[0]!.dirty).toBe(true);
		expect(scheduleSave).not.toHaveBeenCalled();
	});

	it('exportAllZip : annulation desktop ne toast pas et ne clear pas dirty', async () => {
		const files = [file('a'), file('b')];
		const scheduleSave = vi.fn();
		const localDeps = {
			getFiles: () => files as readonly FileItem[],
			scheduleSave
		};
		vi.mocked(services.exportZip).mockResolvedValue(false);
		await exportAllZip(localDeps);
		expect(notify.toasts.some((t) => t.level === 'success')).toBe(false);
		expect(files.every((f) => f.dirty)).toBe(true);
		expect(scheduleSave).not.toHaveBeenCalled();
	});
});

describe('exports face aux erreurs et modifications concurrentes', () => {
	beforeEach(() => {
		notify.clear();
		vi.clearAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	it('affiche les sources illisibles sans demander de consentement réseau', async () => {
		vi.spyOn(promptStore, 'confirm').mockResolvedValue(true);
		vi.mocked(services.exportHTML).mockRejectedValue(
			new MediaPreparationError([{ source: 'figure.png', reason: 'unreadable' }])
		);
		await exportHTML('a', deps);
		expect(promptStore.confirm).not.toHaveBeenCalled();
		expect(notify.toasts.find((toast) => toast.level === 'error')?.message).toContain('figure.png');
	});

	it('signale une erreur Markdown et une erreur ZIP sélection sans succès', async () => {
		vi.mocked(services.exportMarkdown).mockRejectedValue(new Error('write failed'));
		vi.mocked(services.exportZip).mockRejectedValue(new Error('zip failed'));
		await exportMarkdown('a', deps);
		await exportSelectionZip(new Set(['a']), deps);
		expect(notify.toasts.filter((toast) => toast.level === 'error')).toHaveLength(2);
		expect(notify.toasts.some((toast) => toast.level === 'success')).toBe(false);
	});

	it('ne lance aucun PDF pour un identifiant disparu', async () => {
		await exportPDF('missing', deps);
		expect(services.exportPDF).not.toHaveBeenCalled();
	});

	it.each(['rename', 'remove'])(
		'conserve les modifications lors d’un export Markdown : %s',
		async (change) => {
			const files = [file('a')];
			const scheduleSave = vi.fn();
			vi.mocked(services.exportMarkdown).mockImplementation(async () => {
				if (change === 'rename') files[0]!.name = 'new.md';
				else files.pop();
				return true;
			});
			await exportMarkdown('a', { getFiles: () => files, scheduleSave });
			expect(scheduleSave).not.toHaveBeenCalled();
		}
	);

	it('un ZIP confirme uniquement les snapshots encore identiques', async () => {
		const files = [file('a'), file('b'), file('c'), file('d')];
		const scheduleSave = vi.fn();
		vi.mocked(services.exportZip).mockImplementation(async (snapshot) => {
			files[0]!.content = 'new';
			files[1]!.name = 'new.md';
			files.splice(2, 1);
			expect(snapshot[0]?.content).toBe('x');
			return true;
		});
		await exportAllZip({ getFiles: () => files, scheduleSave });
		expect(scheduleSave).toHaveBeenCalledExactlyOnceWith('d');
		expect(files.slice(0, 2).every((item) => item.dirty)).toBe(true);
	});

	it('une annulation du ZIP sélection ne produit pas de succès', async () => {
		vi.mocked(services.exportZip).mockResolvedValue(false);
		await exportSelectionZip(new Set(['a']), deps);
		expect(notify.toasts).toHaveLength(0);
	});
});
