import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	createTauriDiskIo,
	setTauriDiskIoForTests,
	tauriPickAndOpen,
	tauriPickSaveTarget,
	tauriWritePath,
	tauriReadMeta,
	tauriCheckPath,
	tauriOpenAbsolutePaths,
	tauriSaveExportBlob,
	type TauriDiskIo
} from './disk-tauri';

const tauriMocks = vi.hoisted(() => ({
	open: vi.fn(),
	save: vi.fn(),
	invoke: vi.fn()
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
	open: tauriMocks.open,
	save: tauriMocks.save
}));

vi.mock('@tauri-apps/api/core', () => ({
	invoke: tauriMocks.invoke
}));

function mockIo(over: Partial<TauriDiskIo> = {}): TauriDiskIo {
	return {
		openPaths: vi.fn(async () => []),
		savePath: vi.fn(async () => null),
		saveExportPath: vi.fn(async () => null),
		readText: vi.fn(async () => ''),
		writeText: vi.fn(async () => {}),
		writeBytes: vi.fn(async () => {}),
		stat: vi.fn(async () => null),
		...over
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	tauriMocks.open.mockResolvedValue(null);
	tauriMocks.save.mockResolvedValue(null);
	tauriMocks.invoke.mockResolvedValue(null);
	setTauriDiskIoForTests(null);
});

afterEach(() => {
	setTauriDiskIoForTests(null);
});

describe('tauriPickAndOpen', () => {
	it('lit chaque path choisi et construit des OpenedDiskFile', async () => {
		const io = mockIo({
			openPaths: vi.fn(async () => ['/tmp/a.md', '/tmp/b.md']),
			readText: vi.fn(async (p) => (p.endsWith('a.md') ? '# A' : '# B')),
			stat: vi.fn(async () => ({ lastModified: 100, size: 3 }))
		});
		setTauriDiskIoForTests(io);
		const result = await tauriPickAndOpen();
		expect(result.files).toHaveLength(2);
		expect(result.failed).toBe(0);
		expect(result.files[0]).toMatchObject({
			name: 'a.md',
			content: '# A',
			path: '/tmp/a.md',
			link: { kind: 'path', path: '/tmp/a.md' }
		});
		expect(io.readText).toHaveBeenCalledTimes(2);
	});
});

describe('tauriPickSaveTarget', () => {
	it('retourne un PathLinkRecord ou null', async () => {
		setTauriDiskIoForTests(mockIo({ savePath: vi.fn(async () => '/tmp/out.md') }));
		expect(await tauriPickSaveTarget('note.md')).toEqual({
			kind: 'path',
			path: '/tmp/out.md'
		});
		setTauriDiskIoForTests(mockIo({ savePath: vi.fn(async () => null) }));
		expect(await tauriPickSaveTarget('note.md')).toBeNull();
	});
});

describe('tauriSaveExportBlob', () => {
	it('ecrit le blob via writeText pour un export HTML et retourne true', async () => {
		const writeText = vi.fn(async () => {});
		const writeBytes = vi.fn(async () => {});
		setTauriDiskIoForTests(
			mockIo({
				saveExportPath: vi.fn(async () => '/tmp/out.html'),
				writeText,
				writeBytes
			})
		);
		const blob = new Blob(['<html></html>'], { type: 'text/html' });
		expect(await tauriSaveExportBlob(blob, 'out.html')).toBe(true);
		expect(writeText).toHaveBeenCalledWith('/tmp/out.html', '<html></html>');
		expect(writeBytes).not.toHaveBeenCalled();
	});

	it('ecrit en binaire pour un ZIP et retourne false si annule', async () => {
		const writeBytes = vi.fn(async (_path: string, _contents: Uint8Array) => {});
		setTauriDiskIoForTests(
			mockIo({
				saveExportPath: vi.fn(async () => '/tmp/pack.zip'),
				writeBytes
			})
		);
		// Use a plain string Blob then re-encode path as zip for binary branch
		// (jsdom Blob + Uint8Array constructor typing is strict under TS 6).
		const blob = new Blob(['PK\u0003\u0004']);
		expect(await tauriSaveExportBlob(blob, 'pack.zip')).toBe(true);
		expect(writeBytes).toHaveBeenCalledOnce();
		const call = writeBytes.mock.calls[0];
		expect(call?.[0]).toBe('/tmp/pack.zip');
		expect(call?.[1]).toBeInstanceOf(Uint8Array);
		expect(Array.from(call![1]!)).toEqual([0x50, 0x4b, 0x03, 0x04]);

		setTauriDiskIoForTests(mockIo({ saveExportPath: vi.fn(async () => null) }));
		expect(await tauriSaveExportBlob(blob, 'pack.zip')).toBe(false);
	});
});

describe('tauriWritePath / tauriCheckPath', () => {
	it('délègue writeText', async () => {
		const writeText = vi.fn(async () => {});
		setTauriDiskIoForTests(mockIo({ writeText }));
		await tauriWritePath('/tmp/a.md', 'body');
		expect(writeText).toHaveBeenCalledWith('/tmp/a.md', 'body');
	});

	it('check broken si le fichier n existe pas', async () => {
		setTauriDiskIoForTests(mockIo({ stat: vi.fn(async () => null) }));
		expect(await tauriCheckPath('/tmp/missing.md')).toBe('broken');
	});

	it('check ok si stat retourne les métadonnées', async () => {
		setTauriDiskIoForTests(
			mockIo({
				stat: vi.fn(async () => ({ lastModified: 1, size: 1 }))
			})
		);
		expect(await tauriCheckPath('/tmp/a.md')).toBe('ok');
	});

	it('distingue une erreur de permission d un fichier absent', async () => {
		setTauriDiskIoForTests(
			mockIo({
				stat: vi.fn(async () => {
					throw new Error('permission denied');
				})
			})
		);
		expect(await tauriCheckPath('/tmp/a.md')).toBe('permission-needed');
	});
});

describe('tauriOpenAbsolutePaths', () => {
	it('ignore les extensions non markdown et lit les valides', async () => {
		const io = mockIo({
			readText: vi.fn(async () => 'ok'),
			stat: vi.fn(async () => ({ lastModified: 5, size: 2 }))
		});
		setTauriDiskIoForTests(io);
		const result = await tauriOpenAbsolutePaths(['/tmp/x.pdf', '/tmp/y.md']);
		expect(result.files).toHaveLength(1);
		expect(result.files[0]!.name).toBe('y.md');
		expect(result.failed).toBe(0);
		expect(io.readText).toHaveBeenCalledWith('/tmp/y.md');
	});

	it('compte une lecture en erreur sans bloquer les autres fichiers', async () => {
		const io = mockIo({
			readText: vi.fn(async (path) => {
				if (path.endsWith('bad.md')) throw new Error('denied');
				return 'ok';
			}),
			stat: vi.fn(async () => ({ lastModified: 5, size: 2 }))
		});
		setTauriDiskIoForTests(io);
		const result = await tauriOpenAbsolutePaths(['/tmp/bad.md', '/tmp/good.md']);
		expect(result.files).toHaveLength(1);
		expect(result.files[0]!.name).toBe('good.md');
		expect(result.failed).toBe(1);
	});

	it('uses content length when metadata is temporarily unavailable', async () => {
		const io = mockIo({
			readText: vi.fn(async () => 'body'),
			stat: vi.fn(async () => null)
		});
		setTauriDiskIoForTests(io);
		const result = await tauriOpenAbsolutePaths(['/tmp/note.md']);
		expect(result.files[0]!.size).toBe(4);
		expect(result.files[0]!.lastModified).toBeGreaterThan(0);
	});
});

describe('createTauriDiskIo', () => {
	it('adapts native dialog selections and invoke commands', async () => {
		tauriMocks.open
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce('/tmp/note.md')
			.mockResolvedValueOnce(['/tmp/a.md', '/tmp/ignored.pdf']);
		tauriMocks.save.mockResolvedValueOnce('/tmp/output.md').mockResolvedValueOnce(null);
		let missingStat = false;
		tauriMocks.invoke.mockImplementation(async (command: string) => {
			if (command === 'disk_grant') return 1;
			if (command === 'disk_read') return '# Native';
			if (command === 'disk_write' || command === 'disk_write_bytes') return undefined;
			if (command === 'disk_stat') {
				if (missingStat) return null;
				return { mtimeMs: 42, size: 8 };
			}
			return undefined;
		});

		const io = await createTauriDiskIo();

		expect(await io.openPaths(false)).toEqual([]);
		expect(await io.openPaths(false)).toEqual(['/tmp/note.md']);
		expect(await io.openPaths(true)).toEqual(['/tmp/a.md']);
		expect(await io.savePath('note.md')).toBe('/tmp/output.md');
		expect(await io.savePath('note.md')).toBeNull();
		// Bare name from save dialog → auto-append .md for Rust ensure_allowed.
		tauriMocks.save.mockResolvedValueOnce('/tmp/sans-ext');
		expect(await io.savePath('note.md')).toBe('/tmp/sans-ext.md');
		// Export path preserves suggested extension when missing.
		tauriMocks.save.mockResolvedValueOnce('/tmp/export-bare');
		expect(await io.saveExportPath('doc.html')).toBe('/tmp/export-bare.html');
		// Dialog picks grant; bare read/write/stat do not re-grant (Rust enforce).
		expect(tauriMocks.invoke.mock.calls.some((c) => c[0] === 'disk_grant')).toBe(true);
		const grantsBeforeIo = tauriMocks.invoke.mock.calls.filter((c) => c[0] === 'disk_grant').length;
		expect(await io.readText('/tmp/a.md')).toBe('# Native');
		await expect(io.writeText('/tmp/a.md', 'body')).resolves.toBeUndefined();
		expect(await io.stat('/tmp/a.md')).toEqual({ lastModified: 42, size: 8 });
		const grantsAfterIo = tauriMocks.invoke.mock.calls.filter((c) => c[0] === 'disk_grant').length;
		expect(grantsAfterIo).toBe(grantsBeforeIo);
		missingStat = true;
		expect(await io.stat('/tmp/missing.md')).toBeNull();
	});

	it('creates and caches the production adapter through public helpers', async () => {
		tauriMocks.invoke.mockImplementation(async (command: string) => {
			if (command === 'disk_grant') return 1;
			if (command === 'disk_stat') return { mtimeMs: 10, size: 20 };
			return undefined;
		});
		expect(await tauriReadMeta('/tmp/a.md')).toEqual({
			lastModified: 10,
			size: 20
		});
		expect(await tauriReadMeta('/tmp/b.md')).toEqual({
			lastModified: 10,
			size: 20
		});
	});
});
