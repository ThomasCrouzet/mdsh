import { describe, it, expect, vi } from 'vitest';
import { registerFileLaunch, type FileLaunchQueue } from './launch-files';
import { IMPORT_LIMITS } from './config';

vi.mock('./report', () => ({ reportError: vi.fn() }));
vi.mock('./notify.svelte', () => ({ notify: { error: vi.fn() } }));

describe('file launches', () => {
	it('uses the supplied queue once and passes files to the bounded importer', async () => {
		let consumer: Parameters<FileLaunchQueue['setConsumer']>[0] | undefined;
		const setConsumer = vi.fn((value) => {
			consumer = value;
		});
		const importFiles = vi.fn().mockResolvedValue(undefined);
		const file = new File(['# Note'], 'note.md');
		registerFileLaunch({ setConsumer }, importFiles);
		await consumer?.({ files: [{ getFile: async () => file } as FileSystemFileHandle] });
		expect(setConsumer).toHaveBeenCalledTimes(1);
		expect(importFiles).toHaveBeenCalledWith([file]);
	});

	it('bounds handles, preserves readable files, and handles import failures', async () => {
		let consumer: Parameters<FileLaunchQueue['setConsumer']>[0] | undefined;
		const importFiles = vi.fn().mockRejectedValue(new Error('Storage unavailable'));
		registerFileLaunch(
			{
				setConsumer: (value) => {
					consumer = value;
				}
			},
			importFiles
		);
		const read = vi.fn().mockResolvedValue(new File(['x'], 'note.md'));
		const handles = Array.from(
			{ length: IMPORT_LIMITS.maxFiles + 1 },
			() => ({ getFile: read }) as unknown as FileSystemFileHandle
		);
		handles[0] = {
			getFile: async () => {
				throw new Error('Cannot read');
			}
		} as unknown as FileSystemFileHandle;
		await expect(consumer?.({ files: handles })).resolves.toBeUndefined();
		expect(read).toHaveBeenCalledTimes(IMPORT_LIMITS.maxFiles - 1);
		expect(importFiles).toHaveBeenCalledOnce();
		await consumer?.({ files: [] });
		expect(importFiles).toHaveBeenCalledOnce();
		expect(() => registerFileLaunch(undefined, importFiles)).not.toThrow();
	});
});
