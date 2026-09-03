import {
	ImportSession,
	ImportReadError,
	validateMarkdownContent,
	type ImportOptions,
	type ImportReport
} from './import-limits';
// §6.9 / P2.7 - Disk synchronization via FSA (browser) or path links (Tauri).
//
// Groups `openFromDisk`, `saveToDisk`, `saveActiveToDisk`, `unlinkFromDisk`
// and `refreshBrokenLinks` around `fsa.ts` + `broken-links.ts` + `disk-tauri.ts`.
//
// The module stays pure (no Svelte runes, no direct store access):
// all state mutations go through callbacks injected by FilesStore.
// This makes it testable without mounting the full store.
//
// Expected callbacks:
//  - `getFile(id)` → FileItem | undefined   (read from this.files)
//  - `onCreate(name, content)` → FileItem   (delegates to createNew)
//  - `scheduleSave(id)` → void              (schedules Dexie persistence)

import { browser } from '$app/environment';
import { isDesktop } from './desktop';
import {
	checkHandle,
	deleteHandle,
	getHandle,
	getPathLink,
	isFSASupported,
	pickAndOpen,
	pickSaveTarget,
	requestPermission,
	saveHandle,
	savePathLink,
	writeHandle
} from './fsa';
import { computeBrokenLinks } from './broken-links';
import {
	tauriCheckPath,
	tauriOpenNativeGrants,
	tauriPickAndOpen,
	tauriPickDirectoryAndOpen,
	tauriPickSaveTarget,
	tauriReadMeta,
	tauriWritePath,
	type NativeDiskGrant
} from './disk-tauri';
import { t } from '$lib/i18n';
import { notify } from './notify.svelte';
import { promptStore } from './prompt.svelte';
import { reportError } from './report';
import type { FileItem } from './types';

/** Dependencies injected by FilesStore - zero Svelte imports here. */
export interface DiskSyncDeps {
	/** Read access to a FileItem by id. */
	getFile: (id: string) => FileItem | undefined;
	getFiles?: () => FileItem[];
	onActivate?: (id: string) => void;
	/** Creates a new file in the store (delegates to `createNew`). */
	onCreate: (name: string, content: string) => FileItem;
	/** Schedules Dexie persistence of the file (delegates to `scheduleSave`). */
	scheduleSave: (id: string) => void;
	onImportRollback?: (id: string) => void;
}

/** True when either Chromium FSA or the Tauri desktop shell can link files to disk. */
export function isDiskLinkingAvailable(): boolean {
	return isFSASupported() || isDesktop();
}

/**
 * Opens one or more Markdown files from the local file system via the File
 * System Access API (browser) or native dialogs (desktop). Each file is created
 * in the store and its disk link is persisted in IDB (`mdsh-fs`).
 *
 * No-op if neither backend is available or if the user cancels.
 *
 * §D - Per-file protected read (mirrors `FilesStore.importFiles`): if
 * `file.text()`, the creation or the handle persistence fails for a file
 * (it became unreadable/inaccessible between selection and read), we log it
 * and skip that file without breaking the loop - the other files in the
 * selection are still opened. The partial summary ("N opened, M skipped") is
 * surfaced to the user via an info toast; the caller keeps the list of files
 * actually opened (`FileItem[]`).
 */
export async function openFromDisk(
	deps: DiskSyncDeps,
	options: ImportOptions = {}
): Promise<FileItem[]> {
	if (!browser) return [];
	if (isDesktop()) return openFromDiskDesktop(deps, options);
	if (!isFSASupported()) return [];
	return openFromDiskFsa(deps, options);
}

async function openFromDiskFsa(deps: DiskSyncDeps, options: ImportOptions): Promise<FileItem[]> {
	const picked = await pickAndOpen();
	const session = new ImportSession(options);
	const created: FileItem[] = [];
	let failed = 0;
	for (const { handle, file } of picked) {
		if (!(await session.pause())) break;
		let item: FileItem | undefined;
		try {
			const content = await session.read(file);
			if (content === null) {
				if (session.cancelled) break;
				reportError(
					`ouverture du fichier « ${file.name} »`,
					new ImportReadError(session.report.issues.at(-1)!.reason)
				);
				failed++;
				continue;
			}
			item = deps.onCreate(file.name, content);
			item.linkedToDisk = true;
			// §C2 - Records the disk state (mtime + size) at open time. Serves as a
			// reference to detect an external modification before a future write.
			item.diskLastModified = file.lastModified;
			item.diskSize = file.size;
			await saveHandle(item.id, handle);
			created.push(item);
			session.accept();
		} catch (err) {
			if (item) deps.onImportRollback?.(item.id);
			// §D - An unreadable file must not fail the whole selection.
			reportError(`ouverture du fichier « ${file.name} »`, err);
			failed += 1;
			session.fail(file.name, err instanceof ImportReadError ? err.reason : 'read');
		}
	}
	// §D - Partial summary: if some files were skipped while others were
	// successfully opened, the user is told explicitly (info toast).
	if (failed > 0 && created.length > 0) {
		notify.info(t('disk.openPartial', { n: created.length, failed }));
	}
	session.publish();
	return created;
}

async function openFromDiskDesktop(
	deps: DiskSyncDeps,
	options: ImportOptions
): Promise<FileItem[]> {
	const result = await tauriPickAndOpen(options);
	return (await ingestDesktopOpens(result.files, deps, result.failed, options, result.report))
		.files;
}

/** Opens a bounded directory selection through the native desktop capability backend. */
export async function openDirectoryFromDisk(
	deps: DiskSyncDeps,
	options: ImportOptions = {}
): Promise<FileItem[]> {
	if (!browser || !isDesktop()) return [];
	const result = await tauriPickDirectoryAndOpen(options);
	return (await ingestDesktopOpens(result.files, deps, result.failed, options, result.report))
		.files;
}

/**
 * Opens absolute paths from argv / file association (desktop only).
 * Same store outcome as a dialog open (tab + path link).
 */
export async function openPathsFromDesktop(
	grants: NativeDiskGrant[],
	deps: DiskSyncDeps,
	options: ImportOptions = {}
): Promise<DesktopIngestResult> {
	if (!browser || !isDesktop() || grants.length === 0) return { files: [], processedTokens: [] };
	const result = await tauriOpenNativeGrants(grants, options);
	const opened = await ingestDesktopOpens(
		result.files,
		deps,
		result.failed,
		options,
		result.report
	);
	return { files: opened.files, processedTokens: opened.processedTokens };
}

interface DesktopIngestResult {
	files: FileItem[];
	processedTokens: string[];
}

async function ingestDesktopOpens(
	picked: Array<{
		name: string;
		content: string;
		path: string;
		lastModified: number;
		size: number;
		revision: string;
		token?: string;
		link: { kind: 'path'; path: string };
	}>,
	deps: DiskSyncDeps,
	initialFailed = 0,
	options: ImportOptions = {},
	readReport?: ImportReport
): Promise<DesktopIngestResult> {
	const created: FileItem[] = [];
	const processedTokens: string[] = [];
	let failed = initialFailed;
	const session = new ImportSession(options);
	session.report.failed = initialFailed;
	if (readReport) {
		session.report.issues = [...readReport.issues];
		session.report.cancelled = readReport.cancelled;
		session.report.bytes = readReport.bytes;
	}
	session.report.processed = initialFailed;
	session.publish();
	for (const file of picked) {
		if (!(await session.pause())) break;
		let createdItem: FileItem | undefined;
		try {
			let existing: FileItem | undefined;
			for (const candidate of deps.getFiles?.() ?? []) {
				if ((await getPathLink(candidate.id))?.path === file.path) {
					existing = candidate;
					break;
				}
			}
			if (existing) {
				await savePathLink(existing.id, file.link);
				deps.onActivate?.(existing.id);
				created.push(existing);
				const token = file.token ?? picked.find((entry) => entry.path === file.path)?.token;
				if (token) processedTokens.push(token);
				session.accept();
				continue;
			}
			if (!readReport) session.reserve(file.size);
			validateMarkdownContent(file.content);
			const item = deps.onCreate(file.name, file.content);
			createdItem = item;
			item.linkedToDisk = true;
			item.diskLastModified = file.lastModified;
			item.diskSize = file.size;
			item.diskRevision = file.revision;
			await savePathLink(item.id, file.link);
			created.push(item);
			if (file.token) processedTokens.push(file.token);
			session.accept();
		} catch (err) {
			if (createdItem) deps.onImportRollback?.(createdItem.id);
			reportError(`ouverture du fichier « ${file.name} »`, err);
			failed += 1;
			session.fail(file.name, err instanceof ImportReadError ? err.reason : 'read');
		}
	}
	if (failed > 0) {
		if (created.length > 0) {
			notify.info(t('disk.openPartial', { n: created.length, failed }));
		} else {
			notify.error(t('page.openFromDiskError'));
		}
	}
	session.publish();
	return { files: created, processedTokens };
}

/**
 * Saves a file to disk via FSA or path link. If a link already exists (file
 * already linked), reuses it (with a permission check on FSA). Otherwise, opens
 * a native save dialog.
 *
 * Updates `linkedToDisk`, `brokenLink`, `dirty` on the FileItem, then calls
 * `scheduleSave` to persist the state to Dexie.
 *
 * @returns `true` if the write succeeded, `false` otherwise (backend absent,
 *   cancelled, permission denied, or write failure). A toast confirms success
 *   or reports the failure (§J3) - the error is no longer propagated to the caller.
 */
export async function saveToDisk(id: string, deps: DiskSyncDeps): Promise<boolean> {
	if (!browser || !isDiskLinkingAvailable()) return false;
	const file = deps.getFile(id);
	if (!file) return false;

	if (isDesktop()) {
		return saveToDiskDesktop(id, file, deps);
	}
	return saveToDiskFsa(id, file, deps);
}

async function saveToDiskFsa(id: string, file: FileItem, deps: DiskSyncDeps): Promise<boolean> {
	if (!isFSASupported()) return false;
	let handle = await getHandle(id);
	if (handle) {
		const ok = await requestPermission(handle, 'readwrite');
		if (!ok) return false;
		// §C2 - Anti-overwrite guard: before rewriting an already-linked file, we
		// re-read its current disk state and compare it to the recorded reference
		// (mtime/size at open or at the last mdsh write). If the file changed
		// outside the app (cloud sync, git, another editor), a write would
		// silently and irreversibly overwrite it → we ask for explicit
		// confirmation before proceeding.
		if (file.diskLastModified !== undefined) {
			try {
				const onDisk = await handle.getFile();
				const diverged =
					onDisk.lastModified !== file.diskLastModified ||
					(file.diskSize !== undefined && onDisk.size !== file.diskSize);
				if (diverged) {
					const overwrite = await confirmOverwrite(file.name);
					if (!overwrite) {
						notify.info(t('disk.saveCancelled', { name: file.name }));
						return false;
					}
				}
			} catch (err) {
				// Read impossible (file deleted/moved): we let the write below
				// handle the failure and flag the broken link. We only log, without
				// blocking (the write may recreate the file).
				reportError('disk mtime check', err);
			}
		}
	} else {
		const picked = await pickSaveTarget(file.name);
		if (!picked) return false;
		handle = picked;
		await saveHandle(id, handle);
	}
	try {
		await writeHandle(handle, file.content);
	} catch (err) {
		// §6.9 / J3 - Write refused / file not found: we flag the link as broken,
		// notify (toast - the failure was silent, the caller had no catch) and
		// return false. The sidebar also displays the ⚠ badge to unlink or
		// re-target.
		file.brokenLink = true;
		notify.error(t('disk.saveFailed', { name: file.name }));
		reportError('saveToDisk', err);
		return false;
	}
	file.linkedToDisk = true;
	file.brokenLink = false;
	file.dirty = false;
	// §C2 - Refreshes the anti-overwrite reference after a successful write: the
	// disk file now reflects our content, its new mtime becomes the baseline.
	// Without this, the next save would re-trigger the divergence.
	try {
		const written = await handle.getFile();
		file.diskLastModified = written.lastModified;
		file.diskSize = written.size;
	} catch {
		// Re-read impossible right after the write (rare): we invalidate the
		// baseline rather than keep a stale one that would yield a false positive.
		file.diskLastModified = undefined;
		file.diskSize = undefined;
	}
	deps.scheduleSave(id);
	notify.success(t('disk.saved', { name: file.name }));
	return true;
}

async function saveToDiskDesktop(id: string, file: FileItem, deps: DiskSyncDeps): Promise<boolean> {
	let pathRec = await getPathLink(id);
	if (!pathRec) {
		const picked = await tauriPickSaveTarget(file.name);
		if (!picked) return false;
		pathRec = picked;
		await savePathLink(id, pathRec);
		const selected = await tauriReadMeta(pathRec.path);
		file.diskRevision = selected?.revision;
	}
	let written;
	try {
		written = await tauriWritePath(pathRec.path, file.content, file.diskRevision ?? null, false);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.includes('disk conflict')) {
			const overwrite = await confirmOverwrite(file.name);
			if (!overwrite) {
				notify.info(t('disk.saveCancelled', { name: file.name }));
				return false;
			}
			try {
				written = await tauriWritePath(pathRec.path, file.content, file.diskRevision ?? null, true);
			} catch (retryError) {
				return reportDesktopWriteFailure(file, retryError);
			}
		} else if (message.includes('capability expired')) {
			const picked = await tauriPickSaveTarget(file.name);
			if (!picked) return false;
			pathRec = picked;
			await savePathLink(id, pathRec);
			const selected = await tauriReadMeta(pathRec.path);
			try {
				written = await tauriWritePath(
					pathRec.path,
					file.content,
					selected?.revision ?? null,
					false
				);
			} catch (retryError) {
				return reportDesktopWriteFailure(file, retryError);
			}
		} else {
			return reportDesktopWriteFailure(file, err);
		}
	}
	file.linkedToDisk = true;
	file.brokenLink = false;
	file.dirty = false;
	file.diskLastModified = written.lastModified;
	file.diskSize = written.size;
	file.diskRevision = written.revision;
	deps.scheduleSave(id);
	notify.success(t('disk.saved', { name: file.name }));
	return true;
}

function reportDesktopWriteFailure(file: FileItem, err: unknown): false {
	file.brokenLink = true;
	notify.error(t('disk.saveFailed', { name: file.name }));
	reportError('saveToDisk', err);
	return false;
}

async function confirmOverwrite(name: string): Promise<boolean> {
	return promptStore.confirm({
		title: t('disk.overwriteTitle'),
		message: t('disk.overwriteMessage', { name }),
		confirmLabel: t('disk.overwriteConfirm'),
		cancelLabel: t('disk.overwriteCancel'),
		danger: true
	});
}

/**
 * Unlinks a file from its disk link. Deletes the FSA handle / path record from
 * IDB (`mdsh-fs`), then sets `linkedToDisk = false` on the FileItem and schedules
 * a save to persist this state.
 *
 * Always remove the IDB handle first - DiskLinksPanel relies on this guarantee
 * for orphans (handle stored without a file in the store).
 */
export async function unlinkFromDisk(id: string, deps: DiskSyncDeps): Promise<void> {
	await deleteHandle(id);
	const file = deps.getFile(id);
	if (!file) return;
	file.linkedToDisk = false;
	// Intentional unlink: clear the broken-link badge (sidebar keys on brokenLink alone).
	file.brokenLink = false;
	deps.scheduleSave(id);
}

/**
 * Checks all `linkedToDisk` files: if the disk link is no longer resolvable
 * (file moved/deleted), flags `brokenLink: true` on the FileItem. If the link
 * no longer exists in IDB, also resets `linkedToDisk` to false.
 *
 * Pure delegation to `computeBrokenLinks` (testable helper). No-op on SSR
 * when neither FSA nor desktop is available.
 */
export async function refreshBrokenLinks(
	files: readonly FileItem[],
	getFileMutable: (id: string) => FileItem | undefined
): Promise<void> {
	if (!browser || !isDiskLinkingAvailable()) return;
	const updates = await computeBrokenLinks(files, {
		getHandleFn: getHandle,
		checkHandleFn: checkHandle,
		getPathLinkFn: getPathLink,
		checkPathFn: tauriCheckPath
	});
	for (const u of updates) {
		const file = getFileMutable(u.id);
		if (!file) continue;
		file.brokenLink = u.brokenLink;
		// If the handle no longer exists in IDB, we also unlink on the state side:
		// the file stays in the sidebar but loses its "linked" indicator.
		if (u.handleMissing) file.linkedToDisk = false;
	}
}
