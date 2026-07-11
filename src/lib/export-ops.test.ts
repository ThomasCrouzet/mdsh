import { describe, it, expect, beforeEach, vi } from 'vitest';
import { notify } from './notify.svelte';
import type { FileItem } from './types';

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
import { exportHTML, exportPDF, exportAllZip, exportSelectionZip } from './export-ops';

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
		vi.mocked(services.exportHTML).mockResolvedValue(undefined);
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
		vi.mocked(services.exportZip).mockResolvedValue(undefined);
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
		vi.mocked(services.exportZip).mockResolvedValue(undefined);
		await exportSelectionZip(new Set(['a']), deps);
		expect(notify.toasts.some((t) => t.level === 'success')).toBe(true);
	});
});
