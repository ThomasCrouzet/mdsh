/**
 * Path-based disk I/O for the Tauri desktop shell.
 *
 * All `@tauri-apps/*` imports are dynamic so the PWA boot graph never pulls
 * them in. I/O is injectable for unit tests (`createTauriDiskIo` production
 * factory vs mock in tests).
 */

import {
	pathBasename,
	isMarkdownDiskPath,
	ensureMarkdownDiskPath,
	type PathLinkRecord,
	pathLinkRecord
} from './disk-link';
import { t } from '$lib/i18n';

export interface DiskFileMeta {
	lastModified: number;
	size: number;
}

/** Boundary used by open/save helpers - mockable without a real webview. */
export interface TauriDiskIo {
	openPaths(multiple: boolean): Promise<string[]>;
	savePath(suggestedName: string): Promise<string | null>;
	/** Save dialog for export/backup artifacts (md/html/zip/json). */
	saveExportPath(suggestedName: string): Promise<string | null>;
	readText(path: string): Promise<string>;
	writeText(path: string, content: string): Promise<void>;
	writeBytes(path: string, contents: Uint8Array): Promise<void>;
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
	const exportFilters = [
		{
			name: t('disk.fileFilter'),
			extensions: ['md', 'markdown', 'mdx', 'txt', 'html', 'htm', 'zip', 'json']
		}
	];

	/**
	 * Registers dialog / argv paths with the Rust grant set.
	 * Intentionally NOT called from bare read/write/stat: those require a prior
	 * grant (dialog, argv, or explicit grant for a known path-link).
	 * Residual: `disk_grant` remains JS-callable (webview XSS can still grant);
	 * full dialog-in-Rust would close that further.
	 */
	async function grantPaths(paths: string[]): Promise<void> {
		if (paths.length === 0) return;
		await invoke('disk_grant', { paths });
	}

	return {
		async openPaths(multiple) {
			const selected = await open({
				multiple,
				filters,
				directory: false
			});
			if (selected === null) return [];
			const list = Array.isArray(selected) ? selected : [selected];
			const paths = list.filter((p) => typeof p === 'string' && isMarkdownDiskPath(p));
			await grantPaths(paths);
			return paths;
		},
		async savePath(suggestedName) {
			const selected = await save({
				defaultPath: suggestedName,
				filters
			});
			// Dialog may omit the extension - append `.md` so Rust ensure_allowed accepts it.
			const path = typeof selected === 'string' ? ensureMarkdownDiskPath(selected) : null;
			if (path) await grantPaths([path]);
			return path;
		},
		async saveExportPath(suggestedName) {
			const selected = await save({
				defaultPath: suggestedName,
				filters: exportFilters
			});
			if (typeof selected !== 'string') return null;
			// Preserve known export extensions; default bare names to the suggested ext.
			const lower = selected.toLowerCase();
			const path = /\.(md|markdown|mdx|txt|html|htm|zip|json)$/.test(lower)
				? selected
				: `${selected}${suggestedName.match(/(\.[^.]+)$/)?.[1] ?? '.md'}`;
			await grantPaths([path]);
			return path;
		},
		async readText(path) {
			return invoke<string>('disk_read', { path });
		},
		async writeText(path, content) {
			await invoke('disk_write', { path, content });
		},
		async writeBytes(path, contents) {
			// Tauri serializes Uint8Array as number[]; pass a plain array for IPC.
			await invoke('disk_write_bytes', { path, contents: Array.from(contents) });
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

/** Grant a previously linked / dialog path then write (session re-open). */
export async function tauriGrantPaths(paths: string[]): Promise<void> {
	if (paths.length === 0) return;
	const { invoke } = await import('@tauri-apps/api/core');
	await invoke('disk_grant', { paths });
}

export async function tauriWritePath(path: string, content: string): Promise<void> {
	const io = await getIo();
	// Path-link save after restart: re-register the known absolute path.
	await tauriGrantPaths([path]);
	await io.writeText(path, content);
}

/**
 * Desktop-native save for export/backup blobs (md/html/zip/json).
 * Returns true when the user picked a path and the write succeeded;
 * false when the dialog was cancelled.
 */
/** Reads blob bytes - works in real browsers and jsdom (no Blob.arrayBuffer). */
async function readBlobBytes(blob: Blob): Promise<Uint8Array> {
	if (typeof blob.arrayBuffer === 'function') {
		return new Uint8Array(await blob.arrayBuffer());
	}
	// jsdom / older engines: FileReader path.
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
		reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
		reader.readAsArrayBuffer(blob);
	});
}

export async function tauriSaveExportBlob(blob: Blob, suggestedName: string): Promise<boolean> {
	const io = await getIo();
	const path = await io.saveExportPath(suggestedName);
	if (!path) return false;
	const bytes = await readBlobBytes(blob);
	// Prefer text write for UTF-8 text exports (smaller IPC than number arrays for large HTML).
	const isText = /\.(md|markdown|mdx|txt|html|htm|json)$/i.test(path);
	if (isText) {
		const text = new TextDecoder('utf-8').decode(bytes);
		await io.writeText(path, text);
	} else {
		await io.writeBytes(path, bytes);
	}
	return true;
}

export async function tauriReadMeta(path: string): Promise<DiskFileMeta | null> {
	const io = await getIo();
	await tauriGrantPaths([path]);
	return io.stat(path);
}

export async function tauriCheckPath(path: string): Promise<'ok' | 'broken' | 'permission-needed'> {
	const io = await getIo();
	try {
		await tauriGrantPaths([path]);
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
	// Argv paths are also granted in Rust on take_pending; re-grant for path-link I/O.
	const md = paths.filter((p) => isMarkdownDiskPath(p));
	await tauriGrantPaths(md);
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
