import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createTauriDiskIo,
	setTauriDiskIoForTests,
	tauriCheckPath,
	tauriOpenNativeGrants,
	tauriPickAndOpen,
	tauriPickDirectoryAndOpen,
	tauriPickSaveTarget,
	tauriReadMeta,
	tauriSaveExportBlob,
	tauriWritePath,
	type DiskFileMeta,
	type NativeDiskGrant,
	type TauriDiskIo
} from './disk-tauri';

const tauriMocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauriMocks.invoke }));

const meta = (revision = 'sha256:one'): DiskFileMeta => ({
	lastModified: 100,
	size: 3,
	revision
});

const grant = (path: string, token = `token:${path}`): NativeDiskGrant => ({
	token,
	path,
	stat: meta()
});

function mockIo(overrides: Partial<TauriDiskIo> = {}): TauriDiskIo {
	return {
		openGrants: vi.fn(async () => []),
		openDirectoryGrants: vi.fn(async () => []),
		saveGrant: vi.fn(async () => null),
		saveExportGrant: vi.fn(async () => null),
		readFile: vi.fn(async () => ({ content: '', stat: meta() })),
		writeText: vi.fn(async () => meta('sha256:written')),
		writeBytes: vi.fn(async () => meta('sha256:written')),
		stat: vi.fn(async () => null),
		...overrides
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	tauriMocks.invoke.mockResolvedValue(null);
	setTauriDiskIoForTests(null);
});

afterEach(() => setTauriDiskIoForTests(null));

describe('native capability helpers', () => {
	it('opens only the files represented by native grants', async () => {
		const io = mockIo({
			openGrants: vi.fn(async () => [grant('/tmp/a.md', 'a'), grant('/tmp/b.md', 'b')]),
			readFile: vi.fn(async (token) => ({ content: token === 'a' ? '# A' : '# B', stat: meta() }))
		});
		setTauriDiskIoForTests(io);
		const result = await tauriPickAndOpen();
		expect(result.failed).toBe(0);
		expect(result.files.map((file) => file.name)).toEqual(['a.md', 'b.md']);
		expect(result.files[0]?.revision).toBe('sha256:one');
		expect(io.readFile).toHaveBeenCalledWith('a');
	});

	it('opens a directory through the native bounded picker', async () => {
		const io = mockIo({
			openDirectoryGrants: vi.fn(async () => [grant('/tmp/folder/note.md', 'folder-token')]),
			readFile: vi.fn(async () => ({ content: '# Folder', stat: meta() }))
		});
		setTauriDiskIoForTests(io);
		const result = await tauriPickDirectoryAndOpen();
		expect(result.files.map((file) => file.name)).toEqual(['note.md']);
		expect(io.openDirectoryGrants).toHaveBeenCalledOnce();
	});

	it('accepts argv and OS-open capabilities without accepting bare paths', async () => {
		const io = mockIo({
			readFile: vi.fn(async () => ({ content: 'body', stat: meta() }))
		});
		setTauriDiskIoForTests(io);
		const result = await tauriOpenNativeGrants([
			grant('/tmp/note.md', 'native-token'),
			grant('/tmp/ignored.pdf', 'ignored-token')
		]);
		expect(result.files).toHaveLength(1);
		expect(io.readFile).toHaveBeenCalledWith('native-token');
		expect(io.readFile).not.toHaveBeenCalledWith('ignored-token');
	});

	it('registers a save-dialog grant and writes with revision preconditions', async () => {
		const writeText = vi.fn(async () => meta('sha256:after'));
		const io = mockIo({
			saveGrant: vi.fn(async () => grant('/tmp/out.md', 'save-token')),
			writeText
		});
		setTauriDiskIoForTests(io);
		expect(await tauriPickSaveTarget('out.md')).toEqual({ kind: 'path', path: '/tmp/out.md' });
		const written = await tauriWritePath('/tmp/out.md', 'body', 'sha256:one');
		expect(written.revision).toBe('sha256:after');
		expect(writeText).toHaveBeenCalledWith('save-token', 'body', 'sha256:one', false);
	});

	it('does not let a path string mint or recover a capability', async () => {
		const io = mockIo();
		setTauriDiskIoForTests(io);
		await expect(tauriWritePath('/tmp/forged.md', 'body', null)).rejects.toThrow(
			'capability expired'
		);
		expect(io.writeText).not.toHaveBeenCalled();
		expect(await tauriCheckPath('/tmp/forged.md')).toBe('permission-needed');
	});

	it('returns permission-needed for an expired grant and broken for a missing file', async () => {
		const io = mockIo({
			saveGrant: vi.fn(async () => grant('/tmp/missing.md', 'missing-token')),
			stat: vi.fn(async () => null)
		});
		setTauriDiskIoForTests(io);
		await tauriPickSaveTarget('missing.md');
		expect(await tauriCheckPath('/tmp/missing.md')).toBe('broken');
		expect(await tauriCheckPath('/tmp/never-granted.md')).toBe('permission-needed');
	});

	it('reports an existing selected file as available', async () => {
		const io = mockIo({
			saveGrant: vi.fn(async () => grant('/tmp/available.md', 'available-token')),
			stat: vi.fn(async () => meta())
		});
		setTauriDiskIoForTests(io);
		await tauriPickSaveTarget('available.md');
		expect(await tauriCheckPath('/tmp/available.md')).toBe('ok');
	});

	it('returns null when the native save dialog is cancelled', async () => {
		setTauriDiskIoForTests(mockIo());
		await expect(tauriPickSaveTarget('cancelled.md')).resolves.toBeNull();
	});

	it('counts selected files that disappear or cannot be read', async () => {
		const io = mockIo({
			readFile: vi
				.fn()
				.mockRejectedValueOnce(new Error('missing'))
				.mockRejectedValueOnce(new Error('blocked'))
		});
		setTauriDiskIoForTests(io);
		const result = await tauriOpenNativeGrants([
			{ token: 'missing', path: '/tmp/missing.md', stat: null },
			{ token: 'blocked', path: '/tmp/blocked.md', stat: meta() }
		]);
		expect(result).toMatchObject({ files: [], failed: 2 });
	});
});

describe('desktop export', () => {
	it('writes text and binary exports through the token returned by the save dialog', async () => {
		const writeText = vi.fn(async () => meta('sha256:html'));
		const writeBytes = vi.fn(async () => meta('sha256:zip'));
		const io = mockIo({
			saveExportGrant: vi
				.fn()
				.mockResolvedValueOnce(grant('/tmp/out.html', 'html-token'))
				.mockResolvedValueOnce(grant('/tmp/out.zip', 'zip-token')),
			writeText,
			writeBytes
		});
		setTauriDiskIoForTests(io);
		expect(await tauriSaveExportBlob(new Blob(['<p>x</p>']), 'out.html')).toBe(true);
		expect(writeText).toHaveBeenCalledWith('html-token', '<p>x</p>', 'sha256:one', false);
		expect(await tauriSaveExportBlob(new Blob(['PK\u0003\u0004']), 'out.zip')).toBe(true);
		expect(writeBytes).toHaveBeenCalledWith(
			'zip-token',
			expect.any(Uint8Array),
			'sha256:one',
			false
		);
	});

	it('returns false when the native save dialog is cancelled', async () => {
		setTauriDiskIoForTests(mockIo());
		expect(await tauriSaveExportBlob(new Blob(['x']), 'out.html')).toBe(false);
	});
});

describe('production adapter', () => {
	it('uses only native dialog commands and token-based disk commands', async () => {
		tauriMocks.invoke.mockImplementation(async (command: string) => {
			if (command === 'disk_open_dialog') return [grant('/tmp/a.md', 'open-token')];
			if (command === 'disk_open_directory') return [grant('/tmp/folder/a.md', 'folder-token')];
			if (command === 'disk_save_dialog') return grant('/tmp/out.md', 'save-token');
			if (command === 'disk_read') {
				return {
					content: '# Native',
					stat: { mtimeMs: 100, size: 8, revision: 'sha256:one' }
				};
			}
			if (command === 'disk_stat') return { mtimeMs: 100, size: 3, revision: 'sha256:one' };
			if (command === 'disk_write' || command === 'disk_write_bytes') {
				return { mtimeMs: 101, size: 4, revision: 'sha256:two' };
			}
			return null;
		});
		const adapter = await createTauriDiskIo();
		expect((await adapter.openGrants(true))[0]?.token).toBe('open-token');
		expect((await adapter.openDirectoryGrants())[0]?.token).toBe('folder-token');
		expect((await adapter.saveGrant('out.md'))?.token).toBe('save-token');
		expect((await adapter.saveExportGrant('out.zip'))?.token).toBe('save-token');
		expect(await adapter.readFile('open-token')).toEqual({
			content: '# Native',
			stat: { lastModified: 100, size: 8, revision: 'sha256:one' }
		});
		expect((await adapter.stat('open-token'))?.revision).toBe('sha256:one');
		await adapter.writeText('save-token', 'body', 'sha256:one', false);
		await adapter.writeBytes('save-token', new Uint8Array([1]), 'sha256:two', true);
		expect(tauriMocks.invoke).toHaveBeenCalledWith('disk_open_dialog', { multiple: true });
		expect(tauriMocks.invoke).toHaveBeenCalledWith(
			'disk_save_dialog',
			expect.objectContaining({ suggestedName: 'out.md', export: false })
		);
		expect(tauriMocks.invoke).not.toHaveBeenCalledWith('disk_grant', expect.anything());
	});

	it('maps cancelled dialogs and absent native stats to null', async () => {
		tauriMocks.invoke.mockResolvedValue(null);
		const adapter = await createTauriDiskIo();
		await expect(adapter.saveGrant('out.md')).resolves.toBeNull();
		await expect(adapter.saveExportGrant('out.zip')).resolves.toBeNull();
		await expect(adapter.stat('token')).resolves.toBeNull();
	});

	it('caches the production adapter while capabilities remain session-local', async () => {
		tauriMocks.invoke.mockResolvedValue({ mtimeMs: 1, size: 1, revision: 'sha256:x' });
		await expect(tauriReadMeta('/tmp/not-selected.md')).rejects.toThrow('capability expired');
		expect(tauriMocks.invoke).not.toHaveBeenCalled();
	});

	it('partage le chargement paresseux entre deux ouvertures concurrentes', async () => {
		tauriMocks.invoke.mockResolvedValue([]);
		const [first, second] = await Promise.all([tauriPickAndOpen(), tauriPickAndOpen()]);
		expect(first.files).toEqual([]);
		expect(second.files).toEqual([]);
		expect(tauriMocks.invoke).toHaveBeenCalledTimes(2);
	});
});

describe('budgets natifs avant lecture', () => {
	it('refuse fichier et lot trop grands avant leur commande readFile', async () => {
		const grants = Array.from({ length: 6 }, (_, index) => ({
			...grant(`/tmp/${index}.md`),
			stat: { ...meta(), size: index === 0 ? 16 * 1024 * 1024 + 1 : 16 * 1024 * 1024 }
		}));
		const io = mockIo({
			readFile: vi.fn(async () => ({ content: 'x', stat: { ...meta(), size: 16 * 1024 * 1024 } }))
		});
		setTauriDiskIoForTests(io);
		const result = await tauriOpenNativeGrants(grants);
		expect(io.readFile).toHaveBeenCalledTimes(4);
		expect(result.failed).toBe(2);
		expect(result.report?.issues.map((issue) => issue.reason)).toEqual(['file-size', 'batch-size']);
	});
	it('contrôle un grant sans métadonnées et refuse les fichiers disparus', async () => {
		const io = mockIo();
		setTauriDiskIoForTests(io);
		const result = await tauriOpenNativeGrants([{ ...grant('/tmp/missing.md'), stat: null }]);
		expect(result.failed).toBe(1);
		expect(io.stat).toHaveBeenCalled();
		expect(io.readFile).not.toHaveBeenCalled();
	});
	it('refuse croissance et contenu binaire entre stat et read', async () => {
		const io = mockIo({
			readFile: vi
				.fn()
				.mockResolvedValueOnce({ content: 'x', stat: { ...meta(), size: 17 * 1024 * 1024 } })
				.mockResolvedValueOnce({ content: '\0', stat: meta() })
		});
		setTauriDiskIoForTests(io);
		const result = await tauriOpenNativeGrants([grant('/tmp/growing.md'), grant('/tmp/binary.md')]);
		expect(result.failed).toBe(2);
		expect(result.files).toEqual([]);
		expect(result.report?.issues.map((issue) => issue.reason)).toEqual(['file-size', 'binary']);
	});
	it('ignore une réponse native après annulation et ne lit pas le suivant', async () => {
		const controller = new AbortController();
		const io = mockIo({
			readFile: vi.fn(async () => {
				controller.abort();
				return { content: 'x', stat: meta() };
			})
		});
		setTauriDiskIoForTests(io);
		const result = await tauriOpenNativeGrants([grant('/tmp/a.md'), grant('/tmp/b.md')], {
			signal: controller.signal
		});
		expect(result.files).toEqual([]);
		expect(io.readFile).toHaveBeenCalledOnce();
		expect(result.report).toMatchObject({ cancelled: true, failed: 0 });
	});
	it('ignore aussi une erreur de lecture reçue après annulation', async () => {
		const controller = new AbortController();
		const io = mockIo({
			readFile: vi.fn(async () => {
				controller.abort();
				throw new Error('cancelled read');
			})
		});
		setTauriDiskIoForTests(io);
		const result = await tauriOpenNativeGrants([grant('/tmp/a.md'), grant('/tmp/b.md')], {
			signal: controller.signal
		});
		expect(result).toMatchObject({ files: [], failed: 0, report: { cancelled: true } });
		expect(io.readFile).toHaveBeenCalledOnce();
	});
});

describe('branches de garde natives', () => {
	it('ne lance aucune lecture lorsque le lot est déjà annulé', async () => {
		const controller = new AbortController();
		controller.abort();
		const io = mockIo();
		setTauriDiskIoForTests(io);
		const result = await tauriOpenNativeGrants([grant('/tmp/a.md')], { signal: controller.signal });
		expect(result).toMatchObject({ files: [], failed: 0, report: { cancelled: true } });
		expect(io.readFile).not.toHaveBeenCalled();
	});
	it('refuse une croissance qui ferait dépasser le budget cumulé de 64 Mio', async () => {
		const mib = 1024 * 1024;
		const grants = [15, 15, 15, 15, 4].map((size, index) => ({
			...grant(`/tmp/${index}.md`),
			stat: { ...meta(), size: size * mib }
		}));
		const readFile = vi.fn(async (token: string) => {
			const last = token.includes('/4.md');
			return { content: 'ok', stat: { ...meta(), size: (last ? 5 : 15) * mib } };
		});
		const io = mockIo({ readFile });
		setTauriDiskIoForTests(io);
		const result = await tauriOpenNativeGrants(grants);
		expect(result.files).toHaveLength(4);
		expect(result.report?.issues.at(-1)?.reason).toBe('batch-size');
		expect(readFile).toHaveBeenCalledTimes(5);
	});
	it('n’enregistre pas une capacité vide et convertit une stat native absente', async () => {
		const io = mockIo();
		setTauriDiskIoForTests(io);
		await tauriOpenNativeGrants([{ token: '', path: '/tmp/empty.md', stat: meta() }]);
		await expect(tauriWritePath('/tmp/empty.md', 'x', null)).rejects.toThrow('expired');

		setTauriDiskIoForTests(null);
		tauriMocks.invoke.mockImplementation(async (command: string) => {
			if (command === 'disk_open_dialog')
				return [{ token: 'null-stat', path: '/tmp/null.md', stat: null }];
			if (command === 'disk_stat') return null;
			throw new Error(command);
		});
		const result = await tauriPickAndOpen();
		expect(result).toMatchObject({ files: [], failed: 1 });
	});
	it.each([null, new Error('FileReader')])(
		'propage une erreur FileReader de blob export (%s)',
		async (readerError) => {
			const io = mockIo({ saveExportGrant: vi.fn(async () => grant('/tmp/out.pdf')) });
			setTauriDiskIoForTests(io);
			class Reader {
				result = null;
				error = readerError;
				onload: (() => void) | null = null;
				onerror: (() => void) | null = null;
				readAsArrayBuffer() {
					this.onerror?.();
				}
			}
			vi.stubGlobal('FileReader', Reader);
			const blob = { arrayBuffer: undefined } as unknown as Blob;
			try {
				await expect(tauriSaveExportBlob(blob, 'out.pdf')).rejects.toThrow();
			} finally {
				vi.unstubAllGlobals();
			}
		}
	);
	it('écrit un export binaire sans révision via le repli FileReader', async () => {
		const writeBytes = vi.fn(async () => meta('sha256:written'));
		const io = mockIo({
			saveExportGrant: vi.fn(async () => ({ ...grant('/tmp/out.pdf'), stat: null })),
			writeBytes
		});
		setTauriDiskIoForTests(io);
		class Reader {
			result = new Uint8Array([1, 2, 3]).buffer;
			error = null;
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			readAsArrayBuffer() {
				this.onload?.();
			}
		}
		vi.stubGlobal('FileReader', Reader);
		const blob = { arrayBuffer: undefined } as unknown as Blob;
		try {
			await expect(tauriSaveExportBlob(blob, 'out.pdf')).resolves.toBe(true);
			expect(writeBytes).toHaveBeenCalledWith(
				'token:/tmp/out.pdf',
				expect.any(Uint8Array),
				null,
				false
			);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
