import { describe, it, expect, vi } from 'vitest';
import type { FileItem } from './types';
import { computeBrokenLinks, canCheckBrokenLinks } from './broken-links';

// Create a minimal FileItem.
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
	it('ignores files with linkedToDisk set to false', async () => {
		const files = [makeFile({ id: 'f1', linkedToDisk: false })];
		const getHandleFn = vi.fn().mockResolvedValue(null);
		const checkHandleFn = vi.fn();

		const getPathLinkFn = vi.fn().mockResolvedValue(null);
		const updates = await computeBrokenLinks(files, {
			getHandleFn,
			checkHandleFn,
			getPathLinkFn
		});

		expect(updates).toHaveLength(0);
		expect(getHandleFn).not.toHaveBeenCalled();
	});

	it('ignores files without a linkedToDisk value', async () => {
		const files = [makeFile({ id: 'f1' })]; // linkedToDisk non défini
		const getHandleFn = vi.fn().mockResolvedValue(null);
		const checkHandleFn = vi.fn();

		const updates = await computeBrokenLinks(files, {
			getHandleFn,
			checkHandleFn,
			getPathLinkFn: vi.fn().mockResolvedValue(null)
		});

		expect(updates).toHaveLength(0);
	});

	it('handle absent → brokenLink: true, handleMissing: true', async () => {
		const files = [makeFile({ id: 'f1', linkedToDisk: true })];
		const getHandleFn = vi.fn().mockResolvedValue(null); // handle introuvable en IDB
		const checkHandleFn = vi.fn();

		const updates = await computeBrokenLinks(files, {
			getHandleFn,
			checkHandleFn,
			getPathLinkFn: vi.fn().mockResolvedValue(null)
		});

		expect(updates).toHaveLength(1);
		expect(updates[0]).toEqual({ id: 'f1', brokenLink: true, handleMissing: true });
		expect(checkHandleFn).not.toHaveBeenCalled();
	});

	it('sets brokenLink for a broken path link without an FSA handle', async () => {
		const files = [makeFile({ id: 'p1', linkedToDisk: true })];
		const updates = await computeBrokenLinks(files, {
			getHandleFn: vi.fn(),
			checkHandleFn: vi.fn(),
			getPathLinkFn: vi.fn().mockResolvedValue({ kind: 'path', path: '/tmp/gone.md' }),
			checkPathFn: vi.fn().mockResolvedValue('broken')
		});
		expect(updates[0]).toEqual({ id: 'p1', brokenLink: true, handleMissing: false });
	});

	it('marks an existing broken handle as broken but not missing', async () => {
		const fakeHandle = {} as FileSystemFileHandle;
		const files = [makeFile({ id: 'f2', linkedToDisk: true })];
		const getHandleFn = vi.fn().mockResolvedValue(fakeHandle);
		const checkHandleFn = vi.fn().mockResolvedValue('broken');

		const updates = await computeBrokenLinks(files, {
			getHandleFn,
			checkHandleFn,
			getPathLinkFn: vi.fn().mockResolvedValue(null)
		});

		expect(updates).toHaveLength(1);
		expect(updates[0]).toEqual({ id: 'f2', brokenLink: true, handleMissing: false });
	});

	it('marks an existing valid handle as available', async () => {
		const fakeHandle = {} as FileSystemFileHandle;
		const files = [makeFile({ id: 'f3', linkedToDisk: true })];
		const getHandleFn = vi.fn().mockResolvedValue(fakeHandle);
		const checkHandleFn = vi.fn().mockResolvedValue('ok');

		const updates = await computeBrokenLinks(files, {
			getHandleFn,
			checkHandleFn,
			getPathLinkFn: vi.fn().mockResolvedValue(null)
		});

		expect(updates).toHaveLength(1);
		expect(updates[0]).toEqual({ id: 'f3', brokenLink: false, handleMissing: false });
	});

	it('does not mark a handle as broken when it needs permission', async () => {
		const fakeHandle = {} as FileSystemFileHandle;
		const files = [makeFile({ id: 'f4', linkedToDisk: true })];
		const getHandleFn = vi.fn().mockResolvedValue(fakeHandle);
		// permission-needed is not broken, so brokenLink must be false.
		const checkHandleFn = vi.fn().mockResolvedValue('permission-needed');

		const updates = await computeBrokenLinks(files, {
			getHandleFn,
			checkHandleFn,
			getPathLinkFn: vi.fn().mockResolvedValue(null)
		});

		expect(updates).toHaveLength(1);
		expect(updates[0]!.brokenLink).toBe(false);
		expect(updates[0]!.handleMissing).toBe(false);
	});

	it('processes multiple files in parallel and filters them', async () => {
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

		const updates = await computeBrokenLinks(files, {
			getHandleFn,
			checkHandleFn,
			getPathLinkFn: vi.fn().mockResolvedValue(null)
		});

		// Check only the two files that are linked to disk.
		expect(updates).toHaveLength(2);
		const ids = updates.map((u) => u.id);
		expect(ids).toContain('linked-ok');
		expect(ids).toContain('linked-missing');
		expect(ids).not.toContain('not-linked');
	});

	it('returns an empty array when no file is linked to disk', async () => {
		const files = [
			makeFile({ id: 'a', linkedToDisk: false }),
			makeFile({ id: 'b', linkedToDisk: false })
		];
		const getHandleFn = vi.fn();
		const checkHandleFn = vi.fn();

		const updates = await computeBrokenLinks(files, {
			getHandleFn,
			checkHandleFn,
			getPathLinkFn: vi.fn().mockResolvedValue(null)
		});

		expect(updates).toHaveLength(0);
	});

	it('returns an empty array for an empty file list', async () => {
		const updates = await computeBrokenLinks([], {});
		expect(updates).toHaveLength(0);
	});
});

describe('canCheckBrokenLinks', () => {
	it('returns a boolean', () => {
		const result = canCheckBrokenLinks();
		expect(typeof result).toBe('boolean');
	});

	it('returns false in jsdom when showOpenFilePicker is absent', () => {
		// jsdom does not provide the File System Access API.
		expect(canCheckBrokenLinks()).toBe(false);
	});
});
