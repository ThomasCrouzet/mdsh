import { preserveTrashEntry } from '../trash';
import { BACKUP_LIMITS, IMPORT_LIMITS } from '../config';
import { readUtf8File, ImportReadError, validateMarkdownContent } from '../import-limits';
// §1.1 - Versioned backup / restore of portable application state.
//
// All of mdsh lives in IndexedDB (no backend). A "Clear site data", a quota
// eviction, a browser switch or a PWA reinstall = total and silent loss. The
// ZIP export only backs up the `.md` files; this module backs up the STATE:
// drafts (with tab order), workspaces and templates, in a single portable +
// versioned JSON file.
//
// Backup scope:
//   - INCLUDED : open and closed `drafts`, `workspaces`, `templates`.
//   - EXCLUDED : the retained trash and local version history. Concurrent
//                branches are preserved as closed drafts and are included.
//
// Design: pure functions + direct Dexie access (testable via
// fake-indexeddb), no dependency on the runes stores. The DOM helpers
// (download / file read) are guarded with `typeof document/window`.

import { db, newId, type DraftRow, type WorkspaceRow, type TemplateRow } from '../db';
import { encryptString, decryptString, isEncryptedEnvelope } from '../crypto';
import { t } from '$lib/i18n';

export const BACKUP_FORMAT = 'mdsh-backup';
export const BACKUP_SCHEMA_VERSION = 1;

async function ensureLiveDraftsDurable(): Promise<void> {
	const { filesStore } = await import('../files.svelte');
	await filesStore.flushPendingAwait();
}

export interface BackupFile {
	format: typeof BACKUP_FORMAT;
	schemaVersion: number;
	exportedAt: number;
	drafts: DraftRow[];
	workspaces: WorkspaceRow[];
	templates: TemplateRow[];
}

export type RestoreMode = 'merge' | 'replace';

export interface RestoreCounts {
	drafts: number;
	workspaces: number;
	templates: number;
	/**
	 * Total number of entries present in the file but REJECTED as corrupted
	 * (invalid drafts/workspaces/templates filtered out by `parseBackup`). > 0 ⇒ the
	 * restore is partial: should be reported to the user (cf. SettingsPanel).
	 */
	skipped: number;
}

/** Number of entries rejected per collection during the parse (corrupted rows filtered out). */
export interface BackupSkipped {
	drafts: number;
	workspaces: number;
	templates: number;
}

/** Result of `parseBackup`: the valid backup + the count of rejected rows. */
export interface ParsedBackup {
	backup: BackupFile;
	skipped: BackupSkipped;
}

/** Parsing/validation error of a backup file (actionable FR message). */
export class BackupParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BackupParseError';
	}
}

// ─── Collection ──────────────────────────────────────────────────────────────

/** Reads the persisted state and builds the backup object (draft order preserved). */
export async function collectBackup(now = Date.now()): Promise<BackupFile> {
	const [drafts, workspaces, templates] = await Promise.all([
		db.drafts.orderBy('order').toArray(),
		db.workspaces.orderBy('updatedAt').toArray(),
		db.templates.orderBy('updatedAt').toArray()
	]);
	return {
		format: BACKUP_FORMAT,
		schemaVersion: BACKUP_SCHEMA_VERSION,
		exportedAt: now,
		drafts,
		workspaces,
		templates
	};
}

/** Serializes a backup into indented JSON (readable/diffable). */
export function serializeBackup(backup: BackupFile): string {
	return JSON.stringify(backup, null, 2);
}

// ─── Validation ────────────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validDraft(v: unknown): v is DraftRow {
	if (!isObject(v)) return false;
	return (
		typeof v.id === 'string' &&
		v.id.length > 0 &&
		typeof v.name === 'string' &&
		typeof v.content === 'string' &&
		typeof v.createdAt === 'number' &&
		Number.isFinite(v.createdAt) &&
		typeof v.updatedAt === 'number' &&
		Number.isFinite(v.updatedAt) &&
		typeof v.order === 'number' &&
		Number.isFinite(v.order) &&
		(v.open === undefined || typeof v.open === 'boolean')
	);
}

function validWorkspace(v: unknown): v is WorkspaceRow {
	if (!isObject(v)) return false;
	return (
		typeof v.id === 'string' &&
		v.id.length > 0 &&
		typeof v.name === 'string' &&
		Array.isArray(v.fileIds) &&
		v.fileIds.length <= BACKUP_LIMITS.maxWorkspaceReferences &&
		v.fileIds.every((x) => typeof x === 'string' && x.length > 0) &&
		new Set(v.fileIds).size === v.fileIds.length &&
		(v.activeId === null || (typeof v.activeId === 'string' && v.fileIds.includes(v.activeId))) &&
		typeof v.createdAt === 'number' &&
		Number.isFinite(v.createdAt) &&
		typeof v.updatedAt === 'number' &&
		Number.isFinite(v.updatedAt)
	);
}

function validTemplate(v: unknown): v is TemplateRow {
	if (!isObject(v)) return false;
	return (
		typeof v.id === 'string' &&
		v.id.length > 0 &&
		typeof v.name === 'string' &&
		typeof v.content === 'string' &&
		typeof v.builtin === 'boolean' &&
		typeof v.createdAt === 'number' &&
		Number.isFinite(v.createdAt) &&
		typeof v.updatedAt === 'number' &&
		Number.isFinite(v.updatedAt)
	);
}

/**
 * Parses + validates a backup file and reports the rejected rows.
 * The envelope, every required collection and every row must be valid.
 * Invalid or duplicate rows reject the entire restore before any mutation.
 *
 * @throws {BackupParseError} invalid JSON, unexpected format, or future version.
 */
export function parseBackupWithReport(json: string): ParsedBackup {
	assertBackupTextSize(json);
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch {
		throw new BackupParseError(t('backup.invalidJson'));
	}
	if (!isObject(raw) || raw.format !== BACKUP_FORMAT) {
		throw new BackupParseError(t('backup.notMdshBackup'));
	}
	const schemaVersion = raw.schemaVersion;
	// Rejects missing, non-integer (3.5), null or negative versions
	// - symptoms of a corrupted or tampered-with file.
	if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
		throw new BackupParseError(t('backup.invalidSchema'));
	}
	if (schemaVersion > BACKUP_SCHEMA_VERSION) {
		throw new BackupParseError(t('backup.futureVersion', { version: schemaVersion }));
	}
	if (
		!Array.isArray(raw.drafts) ||
		!Array.isArray(raw.workspaces) ||
		!Array.isArray(raw.templates)
	) {
		throw new BackupParseError(t('backup.notMdshBackup'));
	}
	if (typeof raw.exportedAt !== 'number' || !Number.isFinite(raw.exportedAt)) {
		throw new BackupParseError(t('backup.notMdshBackup'));
	}
	if (
		raw.drafts.length + raw.templates.length > BACKUP_LIMITS.maxDocuments ||
		raw.workspaces.length > BACKUP_LIMITS.maxWorkspaces
	)
		throw new BackupParseError(t('backup.tooLarge'));
	const drafts = raw.drafts.filter(validDraft);
	const workspaces = raw.workspaces.filter(validWorkspace);
	const templates = raw.templates.filter(validTemplate);
	const skipped = {
		drafts: raw.drafts.length - drafts.length,
		workspaces: raw.workspaces.length - workspaces.length,
		templates: raw.templates.length - templates.length
	};
	if (skipped.drafts + skipped.workspaces + skipped.templates > 0) {
		throw new BackupParseError(t('backup.notMdshBackup'));
	}
	if (
		workspaces.reduce((total, workspace) => total + workspace.fileIds.length, 0) >
		BACKUP_LIMITS.maxTotalWorkspaceReferences
	)
		throw new BackupParseError(t('backup.tooLarge'));
	let contentBytes = 0;
	for (const row of [...drafts, ...templates]) {
		const size = new TextEncoder().encode(row.content).byteLength;
		contentBytes += size;
		if (size > IMPORT_LIMITS.maxFileBytes || contentBytes > IMPORT_LIMITS.maxBatchBytes)
			throw new BackupParseError(t('backup.tooLarge'));
		try {
			validateMarkdownContent(row.content);
		} catch {
			throw new BackupParseError(t('backup.notMdshBackup'));
		}
	}
	for (const rows of [drafts, workspaces, templates]) {
		if (new Set(rows.map((row) => row.id)).size !== rows.length) {
			throw new BackupParseError(t('backup.notMdshBackup'));
		}
	}
	return {
		backup: {
			format: BACKUP_FORMAT,
			schemaVersion,
			exportedAt: raw.exportedAt,
			drafts,
			workspaces,
			templates
		},
		skipped
	};
}

/**
 * Parses + validates a backup file (without the rejection count - cf.
 * `parseBackupWithReport` when the number of corrupted entries matters).
 *
 * @throws {BackupParseError} invalid JSON, unexpected format, or future version.
 */
export function parseBackup(json: string): BackupFile {
	return parseBackupWithReport(json).backup;
}

// ─── Application ──────────────────────────────────────────────────────────

/**
 * Writes a backup into IndexedDB.
 *
 * - `replace` : first clears drafts/workspaces/templates, then re-inserts everything.
 * - `merge`   : keeps existing rows and imports distinct variants under new
 *               ids. Imported workspace references follow the mapped ids.
 *               Identical variants are not imported twice.
 *
 * Single transaction → atomic (no half-restored state on failure).
 *
 * `skipped` (from the parse) is propagated as is into the result: `applyBackup`
 * only writes already-validated rows, the rejection count comes from upstream.
 */
export async function applyBackup(
	backup: BackupFile,
	mode: RestoreMode,
	skipped = 0
): Promise<RestoreCounts> {
	backup = parseBackupWithReport(serializeBackup(backup)).backup;
	if (skipped > 0) throw new BackupParseError(t('backup.notMdshBackup'));
	await db.transaction(
		'rw',
		[db.drafts, db.workspaces, db.templates, db.versions, db.trashed],
		async () => {
			if (mode === 'replace') {
				// Keep a durable recovery point, including writes from other tabs that
				// committed immediately before this transaction acquired the database.
				const currentDrafts = await db.drafts.toArray();
				for (const current of currentDrafts) {
					const incoming = backup.drafts.find((draft) => draft.id === current.id);
					if (incoming?.content === current.content && incoming.name === current.name) continue;
					await preserveTrashEntry(current.id);
					await db.trashed.put({
						id: current.id,
						file: current,
						order: current.order,
						trashedAt: Date.now()
					});
				}
				await Promise.all([db.drafts.clear(), db.workspaces.clear(), db.templates.clear()]);
				await Promise.all([
					db.drafts.bulkPut(backup.drafts),
					db.workspaces.bulkPut(backup.workspaces),
					db.templates.bulkPut(backup.templates)
				]);
				return;
			}
			// merge
			const existing = await db.drafts.toArray();
			const currentById = new Map(existing.map((d) => [d.id, d]));
			const allDrafts = [...existing];
			const importedIdMap = new Map<string, string>();
			let maxOrder = existing.reduce((m, d) => Math.max(m, d.order), -1);
			const draftsToPut = backup.drafts.map((d) => {
				const sameVariant = allDrafts.find(
					(row) =>
						row.name === d.name &&
						row.content === d.content &&
						row.createdAt === d.createdAt &&
						row.updatedAt === d.updatedAt
				);
				if (sameVariant) {
					importedIdMap.set(d.id, sameVariant.id);
					return null;
				}
				const collision = currentById.has(d.id);
				const id = collision ? newId() : d.id;
				const row = { ...d, id, order: ++maxOrder };
				importedIdMap.set(d.id, id);
				allDrafts.push(row);
				return row;
			});
			const existingWorkspaces = await db.workspaces.toArray();
			const workspaceIds = new Set(existingWorkspaces.map((row) => row.id));
			const workspacesToPut = backup.workspaces.flatMap((workspace) => {
				const mapped = {
					...workspace,
					fileIds: [...new Set(workspace.fileIds.map((id) => importedIdMap.get(id) ?? id))],
					activeId: workspace.activeId
						? (importedIdMap.get(workspace.activeId) ?? workspace.activeId)
						: null
				};
				const identical = existingWorkspaces.some(
					(row) =>
						row.name === mapped.name &&
						row.activeId === mapped.activeId &&
						row.createdAt === mapped.createdAt &&
						row.updatedAt === mapped.updatedAt &&
						row.fileIds.join('\0') === mapped.fileIds.join('\0')
				);
				if (identical) return [];
				return [{ ...mapped, id: workspaceIds.has(mapped.id) ? newId() : mapped.id }];
			});
			const existingTemplates = await db.templates.toArray();
			const templateIds = new Set(existingTemplates.map((row) => row.id));
			const templatesToPut = backup.templates.flatMap((template) => {
				const identical = existingTemplates.some(
					(row) =>
						row.name === template.name &&
						row.content === template.content &&
						row.builtin === template.builtin &&
						row.createdAt === template.createdAt &&
						row.updatedAt === template.updatedAt
				);
				if (identical) return [];
				return [{ ...template, id: templateIds.has(template.id) ? newId() : template.id }];
			});
			await Promise.all([
				db.drafts.bulkPut(draftsToPut.filter((row): row is DraftRow => row !== null)),
				db.workspaces.bulkPut(workspacesToPut),
				db.templates.bulkPut(templatesToPut)
			]);
		}
	);
	return {
		drafts: backup.drafts.length,
		workspaces: backup.workspaces.length,
		templates: backup.templates.length,
		skipped
	};
}

// ─── DOM orchestration (download / file read) ───────────────────────────────

/**
 * @returns `true` when a download/save was initiated; `false` when the user
 * cancelled the desktop save dialog.
 */
async function triggerDownload(blob: Blob, filename: string): Promise<boolean> {
	const { isDesktop } = await import('../desktop');
	if (isDesktop()) {
		const { tauriSaveExportBlob } = await import('../disk-tauri');
		return await tauriSaveExportBlob(blob, filename);
	}
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
	return true;
}

/**
 * Builds the backup and triggers its download. If `passphrase` is
 * provided (§2.8), the content is encrypted (AES-GCM) and the file is unreadable
 * without the passphrase.
 *
 * @returns `false` if the desktop save dialog was cancelled (no success toast).
 */
export async function downloadBackup(
	passphrase?: string,
	ensureDurable: () => Promise<void> = ensureLiveDraftsDurable
): Promise<boolean> {
	if (typeof document === 'undefined') return false;
	await ensureDurable();
	const now = Date.now();
	const backup = await collectBackup(now);
	const json = serializeBackup(backup);
	parseBackupWithReport(json);
	const stamp = new Date(now).toISOString().slice(0, 10);
	if (passphrase) {
		const envelope = await encryptString(json, passphrase);
		const encrypted = JSON.stringify(envelope);
		assertBackupTextSize(encrypted);
		const blob = new Blob([encrypted], { type: 'application/json;charset=utf-8' });
		return triggerDownload(blob, `mdsh-backup-${stamp}.encrypted.json`);
	}
	const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
	return triggerDownload(blob, `mdsh-backup-${stamp}.json`);
}

/** §2.8 - Detects whether a backup text is an encrypted envelope. */
export function isEncryptedBackup(text: string): boolean {
	assertBackupTextSize(text);
	try {
		return isEncryptedEnvelope(JSON.parse(text));
	} catch {
		return false;
	}
}

/** §2.8 - Decrypts a backup envelope → plaintext JSON. */
export async function decryptBackupText(text: string, passphrase: string): Promise<string> {
	assertBackupTextSize(text);
	let env: unknown;
	try {
		env = JSON.parse(text);
	} catch {
		throw new BackupParseError(t('backup.encryptedInvalidJson'));
	}
	if (!isEncryptedEnvelope(env)) throw new BackupParseError(t('backup.notEncrypted'));
	return decryptString(env, passphrase);
}

/**
 * Restores from a text (plaintext or encrypted). If encrypted, `passphrase` is
 * required (otherwise BackupParseError). Validates then applies according to `mode`.
 */
export async function restoreFromText(
	text: string,
	mode: RestoreMode,
	passphrase?: string,
	ensureDurable: () => Promise<void> = ensureLiveDraftsDurable
): Promise<RestoreCounts> {
	await ensureDurable();
	let json = text;
	if (isEncryptedBackup(text)) {
		if (!passphrase) throw new BackupParseError(t('backup.passphraseRequired'));
		json = await decryptBackupText(text, passphrase);
	}
	const { backup, skipped } = parseBackupWithReport(json);
	const skippedTotal = skipped.drafts + skipped.workspaces + skipped.templates;
	return applyBackup(backup, mode, skippedTotal);
}

/** Reads a backup file (plaintext or encrypted), validates it and applies it. */
export async function restoreFromFile(
	file: File,
	mode: RestoreMode,
	passphrase?: string
): Promise<RestoreCounts> {
	let text: string;
	try {
		text = await readUtf8File(file, IMPORT_LIMITS.maxBatchBytes);
	} catch (error) {
		if (error instanceof ImportReadError)
			throw new BackupParseError(
				t(error.reason === 'file-size' ? 'backup.tooLarge' : 'backup.invalidJson')
			);
		throw error;
	}
	return restoreFromText(text, mode, passphrase);
}

function assertBackupTextSize(text: string): void {
	if (
		text.length > IMPORT_LIMITS.maxBatchBytes ||
		new TextEncoder().encode(text).byteLength > IMPORT_LIMITS.maxBatchBytes
	)
		throw new BackupParseError(t('backup.tooLarge'));
}
