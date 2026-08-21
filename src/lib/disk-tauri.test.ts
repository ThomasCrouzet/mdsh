import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createTauriDiskIo,
	setTauriDiskIoForTests,
	tauriCheckPath,
	tauriOpenNativeGrants,
	tauriPickAndOpen,
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
		saveGrant: vi.fn(async () => null),
		saveExportGrant: vi.fn(async () => null),
		readText: vi.fn(async () => ''),
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
			readText: vi.fn(async (token) => (token === 'a' ? '# A' : '# B')),
			stat: vi.fn(async () => meta())
		});
		setTauriDiskIoForTests(io);
		const result = await tauriPickAndOpen();
		expect(result.failed).toBe(0);
		expect(result.files.map((file) => file.name)).toEqual(['a.md', 'b.md']);
		expect(result.files[0]?.revision).toBe('sha256:one');
		expect(io.readText).toHaveBeenCalledWith('a');
	});

	it('accepts argv and OS-open capabilities without accepting bare paths', async () => {
		const io = mockIo({
			readText: vi.fn(async () => 'body'),
			stat: vi.fn(async () => meta())
		});
		setTauriDiskIoForTests(io);
		const result = await tauriOpenNativeGrants([
			grant('/tmp/note.md', 'native-token'),
			grant('/tmp/ignored.pdf', 'ignored-token')
		]);
		expect(result.files).toHaveLength(1);
		expect(io.readText).toHaveBeenCalledWith('native-token');
		expect(io.readText).not.toHaveBeenCalledWith('ignored-token');
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
			readText: vi.fn().mockResolvedValueOnce('body').mockRejectedValueOnce(new Error('blocked')),
			stat: vi.fn(async () => null)
		});
		setTauriDiskIoForTests(io);
		const result = await tauriOpenNativeGrants([
			{ token: 'missing', path: '/tmp/missing.md', stat: null },
			{ token: 'blocked', path: '/tmp/blocked.md', stat: meta() }
		]);
		expect(result).toEqual({ files: [], failed: 2 });
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
			if (command === 'disk_save_dialog') return grant('/tmp/out.md', 'save-token');
			if (command === 'disk_read') return '# Native';
			if (command === 'disk_stat') return { mtimeMs: 100, size: 3, revision: 'sha256:one' };
			if (command === 'disk_write' || command === 'disk_write_bytes') {
				return { mtimeMs: 101, size: 4, revision: 'sha256:two' };
			}
			return null;
		});
		const adapter = await createTauriDiskIo();
		expect((await adapter.openGrants(true))[0]?.token).toBe('open-token');
		expect((await adapter.saveGrant('out.md'))?.token).toBe('save-token');
		expect(await adapter.readText('open-token')).toBe('# Native');
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
});
