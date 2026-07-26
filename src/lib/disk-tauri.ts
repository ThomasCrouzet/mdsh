/**
 * Path-based disk I/O for the Tauri desktop shell.
 *
 * All `@tauri-apps/*` imports are dynamic so the PWA boot graph never pulls
 * them in. I/O is injectable for unit tests (`createTauriDiskIo` production
 * factory vs mock in tests).
 */

import { pathBasename, isMarkdownDiskPath, type PathLinkRecord, pathLinkRecord } from './disk-link';
import { t } from '$lib/i18n';

export interface DiskFileMeta {
	lastModified: number;
	size: number;
}

/** Boundary used by open/save helpers - mockable without a real webview. */
export interface TauriDiskIo {
	openPaths(multiple: boolean): Promise<string[]>;
	savePath(suggestedName: string): Promise<string | null>;
	readText(path: string): Promise<string>;
	writeText(path: string, content: string): Promise<void>;
	stat(path: string): Promise<DiskFileMeta | null>;
}

export interface OpenedDiskFile {
	name: string;
	content: string;
	path: string;
	lastModified: number;
	size: number;
	link: PathLinkRecord;
}

export interface OpenedDiskFiles {
	files: OpenedDiskFile[];
	failed: number;
}

let _io: TauriDiskIo | null = null;
let _ioPromise: Promise<TauriDiskIo> | null = null;

/** Test seam: inject a mock I/O implementation. */
export function setTauriDiskIoForTests(io: TauriDiskIo | null): void {
	_io = io;
	_ioPromise = io ? Promise.resolve(io) : null;
}

/**
 * Production I/O: dialog plugin for pickers + Rust `disk_*` commands for
 * read/write/stat (extension-gated, works for argv-opened paths too).
 */
export async function createTauriDiskIo(): Promise<TauriDiskIo> {
	const { open, save } = await import('@tauri-apps/plugin-dialog');
	const { invoke } = await import('@tauri-apps/api/core');

	const extensions = ['md', 'markdown', 'mdx', 'txt'];
	const filters = [
		{
			name: t('disk.fileFilter'),
			extensions
		}
	];

	return {
		async openPaths(multiple) {
			const selected = await open({
				multiple,
				filters,
				directory: false
			});
			if (selected === null) return [];
			const list = Array.isArray(selected) ? selected : [selected];
			return list.filter((p) => typeof p === 'string' && isMarkdownDiskPath(p));
		},
		async savePath(suggestedName) {
			const selected = await save({
				defaultPath: suggestedName,
				filters
			});
			return typeof selected === 'string' ? selected : null;
		},
		async readText(path) {
			return invoke<string>('disk_read', { path });
		},
		async writeText(path, content) {
			await invoke('disk_write', { path, content });
		},
		async stat(path) {
			const s = await invoke<{ mtimeMs: number; size: number } | null>('disk_stat', {
				path
			});
			if (!s) return null;
			return { lastModified: s.mtimeMs, size: s.size };
		}
	};
}

async function getIo(): Promise<TauriDiskIo> {
	if (_io) return _io;
	if (!_ioPromise) {
		_ioPromise = createTauriDiskIo().then((io) => {
			_io = io;
			return io;
		});
	}
	return _ioPromise;
}

export async function tauriPickAndOpen(): Promise<OpenedDiskFiles> {
	const io = await getIo();
	const paths = await io.openPaths(true);
	return openPaths(paths, io);
}

export async function tauriPickSaveTarget(suggestedName: string): Promise<PathLinkRecord | null> {
	const io = await getIo();
	const path = await io.savePath(suggestedName);
	if (!path) return null;
	return pathLinkRecord(path);
}

export async function tauriWritePath(path: string, content: string): Promise<void> {
	const io = await getIo();
	await io.writeText(path, content);
}

export async function tauriReadMeta(path: string): Promise<DiskFileMeta | null> {
	const io = await getIo();
	return io.stat(path);
}

export async function tauriCheckPath(path: string): Promise<'ok' | 'broken' | 'permission-needed'> {
	const io = await getIo();
	try {
		return (await io.stat(path)) ? 'ok' : 'broken';
	} catch {
		return 'permission-needed';
	}
}

/**
 * Opens absolute paths from argv / file association (no dialog).
 * Skips non-markdown paths; fails soft per file.
 */
export async function tauriOpenAbsolutePaths(paths: string[]): Promise<OpenedDiskFiles> {
	const io = await getIo();
	return openPaths(paths, io);
}

async function openPaths(paths: string[], io: TauriDiskIo): Promise<OpenedDiskFiles> {
	const out: OpenedDiskFile[] = [];
	let failed = 0;
	for (const path of paths) {
		if (!isMarkdownDiskPath(path)) continue;
		try {
			const content = await io.readText(path);
			const meta = (await io.stat(path)) ?? {
				lastModified: Date.now(),
				size: content.length
			};
			out.push({
				name: pathBasename(path) || 'untitled.md',
				content,
				path,
				lastModified: meta.lastModified,
				size: meta.size,
				link: pathLinkRecord(path)
			});
		} catch {
			failed += 1;
		}
	}
	return { files: out, failed };
}
