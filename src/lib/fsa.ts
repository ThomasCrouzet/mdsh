import { browser } from '$app/environment';
import { t } from '$lib/i18n';
import { isPathLinkRecord, pathBasename, type PathLinkRecord } from './disk-link';

export interface StoredHandle {
	id: string;
	handle: FileSystemFileHandle;
}

/** Unified disk link entry for DiskLinksPanel / broken-link checks. */
export type StoredDiskLink =
	| { id: string; kind: 'fsa'; handle: FileSystemFileHandle; label: string }
	| { id: string; kind: 'path'; path: string; label: string };

const HANDLE_DB = 'mdsh-fs';
const HANDLE_STORE = 'handles';

// §A2.7 - IDB connection cache. Previously each saveHandle / getHandle /
// deleteHandle opened + closed the DB → N open/close cycles on load plus a
// listHandles that reopened it for nothing. We keep a single live connection
// (IDB's `onclose` nullifies it if the DB is versioned outside the app, which
// should not happen for mdsh-fs).
let _handleDb: IDBDatabase | null = null;
let _handleDbPromise: Promise<IDBDatabase> | null = null;

function openHandleDB(): Promise<IDBDatabase> {
	if (_handleDb) return Promise.resolve(_handleDb);
	if (_handleDbPromise) return _handleDbPromise;
	_handleDbPromise = new Promise((resolve, reject) => {
		const req = indexedDB.open(HANDLE_DB, 1);
		req.onupgradeneeded = () => {
			req.result.createObjectStore(HANDLE_STORE);
		};
		req.onsuccess = () => {
			_handleDb = req.result;
			// If the DB is closed by another tab (versionchange) or aborted, we
			// invalidate the cache to force a clean reopen on the next call.
			_handleDb.onclose = () => {
				_handleDb = null;
				_handleDbPromise = null;
			};
			_handleDb.onversionchange = () => {
				_handleDb?.close();
				_handleDb = null;
				_handleDbPromise = null;
			};
			resolve(_handleDb);
		};
		req.onerror = () => {
			_handleDbPromise = null;
			reject(req.error);
		};
	});
	return _handleDbPromise;
}

export function isFSASupported(): boolean {
	return browser && 'showOpenFilePicker' in window && 'showSaveFilePicker' in window;
}

/** §2.3 - Directory picker support (Chromium only, like the rest of FSA). */
export function isDirectoryPickerSupported(): boolean {
	return browser && 'showDirectoryPicker' in window;
}

// §2.3 - Directory import guards: we cap the recursion depth and the number of
// files so we don't DoS the app on a giant directory (node_modules, a vault of
// thousands of notes). Consistent with the app's target scale of a few hundred
// files (see docs/DEVELOPMENT.md, "Design limits").
const DIR_MAX_DEPTH = 8;
const DIR_MAX_FILES = 500;
const MD_FILE_RE = /\.(md|markdown|mdx|txt)$/i;

async function collectMarkdownFiles(
	dir: MdshDirectoryHandle,
	out: Array<{ name: string; content: string }>,
	depth: number
): Promise<void> {
	if (depth > DIR_MAX_DEPTH || out.length >= DIR_MAX_FILES) return;
	for await (const entry of dir.values()) {
		if (out.length >= DIR_MAX_FILES) return;
		if (entry.kind === 'file') {
			if (!MD_FILE_RE.test(entry.name)) continue;
			try {
				const file = await entry.getFile();
				out.push({ name: entry.name, content: await file.text() });
			} catch {
				// Unreadable file (permission, deleted in flight) - we skip it.
			}
		} else {
			// Ignores hidden directories / common bulky dependencies.
			if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
			await collectMarkdownFiles(entry, out, depth + 1);
		}
	}
}

/**
 * §2.3 - Opens a directory picker and recursively collects markdown files
 * (.md/.markdown/.mdx/.txt). Returns `{ name, content }[]` (empty if cancelled
 * or unsupported). Capped (depth + count) by the guard.
 *
 * `flagTruncated` is set to true if the file cap was reached (the caller can
 * inform the user).
 */
export async function pickDirectoryFiles(): Promise<{
	files: Array<{ name: string; content: string }>;
	truncated: boolean;
}> {
	if (!isDirectoryPickerSupported() || !window.showDirectoryPicker) {
		return { files: [], truncated: false };
	}
	try {
		const dir = await window.showDirectoryPicker({ mode: 'read' });
		const files: Array<{ name: string; content: string }> = [];
		await collectMarkdownFiles(dir, files, 0);
		return { files, truncated: files.length >= DIR_MAX_FILES };
	} catch (err) {
		if ((err as Error).name === 'AbortError') return { files: [], truncated: false };
		throw err;
	}
}

export async function saveHandle(id: string, handle: FileSystemFileHandle): Promise<void> {
	if (!browser) return;
	const db = await openHandleDB();
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(HANDLE_STORE, 'readwrite');
		tx.objectStore(HANDLE_STORE).put(handle, id);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

/** Persists a path-based disk link (desktop). Overwrites any prior FSA handle. */
export async function savePathLink(id: string, record: PathLinkRecord): Promise<void> {
	if (!browser) return;
	const db = await openHandleDB();
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(HANDLE_STORE, 'readwrite');
		tx.objectStore(HANDLE_STORE).put(record, id);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

export async function getHandle(id: string): Promise<FileSystemFileHandle | null> {
	if (!browser) return null;
	const db = await openHandleDB();
	const value = await new Promise<unknown>((resolve, reject) => {
		const tx = db.transaction(HANDLE_STORE, 'readonly');
		const req = tx.objectStore(HANDLE_STORE).get(id);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
	if (value == null || isPathLinkRecord(value)) return null;
	return value as FileSystemFileHandle;
}

export async function getPathLink(id: string): Promise<PathLinkRecord | null> {
	if (!browser) return null;
	const db = await openHandleDB();
	const value = await new Promise<unknown>((resolve, reject) => {
		const tx = db.transaction(HANDLE_STORE, 'readonly');
		const req = tx.objectStore(HANDLE_STORE).get(id);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
	return isPathLinkRecord(value) ? value : null;
}

export async function deleteHandle(id: string): Promise<void> {
	if (!browser) return;
	const db = await openHandleDB();
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(HANDLE_STORE, 'readwrite');
		tx.objectStore(HANDLE_STORE).delete(id);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

export async function requestPermission(
	handle: FileSystemFileHandle,
	mode: 'read' | 'readwrite' = 'readwrite'
): Promise<boolean> {
	if (!handle.queryPermission || !handle.requestPermission) return false;
	const opts = { mode };
	const query = await handle.queryPermission(opts);
	if (query === 'granted') return true;
	const request = await handle.requestPermission(opts);
	return request === 'granted';
}

export async function pickAndOpen(): Promise<Array<{ handle: FileSystemFileHandle; file: File }>> {
	if (!isFSASupported() || !window.showOpenFilePicker) return [];
	try {
		const handles = await window.showOpenFilePicker({
			multiple: true,
			types: [
				{
					description: t('disk.fileFilter'),
					accept: {
						'text/markdown': ['.md', '.markdown', '.mdx'],
						'text/plain': ['.txt']
					}
				}
			]
		});
		const out: Array<{ handle: FileSystemFileHandle; file: File }> = [];
		for (const h of handles) {
			const file = await h.getFile();
			out.push({ handle: h, file });
		}
		return out;
	} catch (err) {
		if ((err as Error).name === 'AbortError') return [];
		throw err;
	}
}

export async function pickSaveTarget(suggestedName: string): Promise<FileSystemFileHandle | null> {
	if (!isFSASupported() || !window.showSaveFilePicker) return null;
	try {
		return await window.showSaveFilePicker({
			suggestedName,
			types: [
				{
					description: t('disk.fileFilter'),
					accept: { 'text/markdown': ['.md'] }
				}
			]
		});
	} catch (err) {
		if ((err as Error).name === 'AbortError') return null;
		throw err;
	}
}

export async function writeHandle(handle: FileSystemFileHandle, content: string): Promise<void> {
	if (!handle.createWritable) throw new Error('createWritable not supported');
	const writable = await handle.createWritable();
	await writable.write(content);
	await writable.close();
}

/**
 * Lists all `FileSystemFileHandle`s stored in IDB (`mdsh-fs.handles`).
 * Returns a `{ id, handle }` array ordered by IDB's internal order (insertion
 * order for an object store without an index).
 *
 * Fail-soft: if IDB is unavailable (private mode on some browsers, quota
 * exceeded, FSA support absent…) returns `[]` rather than throwing - the UI
 * panel will display "no link" instead of crashing.
 */
export async function listHandles(): Promise<Array<{ id: string; handle: FileSystemFileHandle }>> {
	const all = await listDiskLinks();
	return all
		.filter((e): e is Extract<StoredDiskLink, { kind: 'fsa' }> => e.kind === 'fsa')
		.map(({ id, handle }) => ({ id, handle }));
}

/**
 * Lists every disk link (FSA handles + desktop path records) stored in IDB.
 * Fail-soft: returns `[]` if IDB is unavailable.
 */
export async function listDiskLinks(): Promise<StoredDiskLink[]> {
	if (!browser) return [];
	try {
		const db = await openHandleDB();
		const entries = await new Promise<StoredDiskLink[]>((resolve, reject) => {
			const tx = db.transaction(HANDLE_STORE, 'readonly');
			const store = tx.objectStore(HANDLE_STORE);
			const out: StoredDiskLink[] = [];
			const req = store.openCursor();
			req.onsuccess = () => {
				const cursor = req.result;
				if (cursor) {
					const id = String(cursor.key);
					const value = cursor.value;
					if (isPathLinkRecord(value)) {
						out.push({
							id,
							kind: 'path',
							path: value.path,
							label: pathBasename(value.path) || value.path
						});
					} else if (value != null) {
						const handle = value as FileSystemFileHandle;
						const name =
							typeof handle.name === 'string' && handle.name.length > 0 ? handle.name : id;
						out.push({ id, kind: 'fsa', handle, label: name });
					}
					cursor.continue();
				} else {
					resolve(out);
				}
			};
			req.onerror = () => reject(req.error);
		});
		return entries;
	} catch {
		return [];
	}
}

/**
 * Checks whether a handle still points to an accessible file.
 *
 * - `'ok'`: readwrite permission already granted and `getFile()` succeeds.
 * - `'permission-needed'`: the handle is valid but the user must re-authorize
 *   access (revocation after reload on Chrome, for example).
 * - `'broken'`: `getFile()` throws NotFoundError or other - file
 *   moved/deleted/disk ejected. The user must unlink.
 *
 * No side-effect (no user prompt): we use `queryPermission`, which returns the
 * current state without showing a dialog. The UI's "Check" button must be able
 * to run repeatedly without bothering the user.
 */
export async function checkHandle(
	handle: FileSystemFileHandle
): Promise<'ok' | 'permission-needed' | 'broken'> {
	if (!handle.queryPermission) return 'broken';
	try {
		const perm = await handle.queryPermission({ mode: 'readwrite' });
		if (perm !== 'granted') return 'permission-needed';
	} catch {
		return 'broken';
	}
	// Permission OK; we try to read the file to validate it still exists.
	// Without this call, a file deleted after authorization would pass as 'ok'
	// until the next write.
	try {
		await handle.getFile();
		return 'ok';
	} catch {
		return 'broken';
	}
}
