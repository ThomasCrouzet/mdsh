// §1.1 - Versioned backup / restore of portable application state.
//
// All of mdsh lives in IndexedDB (no backend). A "Clear site data", a quota
// eviction, a browser switch or a PWA reinstall = total and silent loss. The
// ZIP export only backs up the `.md` files; this module backs up the STATE:
// drafts (with tab order), workspaces and templates, in a single portable +
// versioned JSON file.
//
// Backup scope:
//   - INCLUDED : `drafts` (content + order), `workspaces`, `templates`.
//   - EXCLUDED : `trashed` (trash, ephemeral) and `versions` (local history,
//                large + reconstructible) - these are transient data, not the
//                state the user wants to carry over.
//
// Design: pure functions + direct Dexie access (testable via
// fake-indexeddb), no dependency on the runes stores. The DOM helpers
// (download / file read) are guarded with `typeof document/window`.

import { db, type DraftRow, type WorkspaceRow, type TemplateRow } from '../db';
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
		typeof v.name === 'string' &&
		typeof v.content === 'string' &&
		typeof v.createdAt === 'number' &&
		typeof v.updatedAt === 'number' &&
		typeof v.order === 'number'
	);
}

function validWorkspace(v: unknown): v is WorkspaceRow {
	if (!isObject(v)) return false;
	return (
		typeof v.id === 'string' &&
		typeof v.name === 'string' &&
		Array.isArray(v.fileIds) &&
		v.fileIds.every((x) => typeof x === 'string') &&
		(v.activeId === null || typeof v.activeId === 'string') &&
		typeof v.createdAt === 'number' &&
		typeof v.updatedAt === 'number'
	);
}

function validTemplate(v: unknown): v is TemplateRow {
	if (!isObject(v)) return false;
	return (
		typeof v.id === 'string' &&
		typeof v.name === 'string' &&
		typeof v.content === 'string' &&
		typeof v.builtin === 'boolean' &&
		typeof v.createdAt === 'number' &&
		typeof v.updatedAt === 'number'
	);
}

/**
 * Counts the rejected entries of a collection: present in the raw array but
 * filtered out as invalid. A non-array raw value is treated as 0 entries
 * (nothing to reject: it is not an item corruption but a missing field).
 */
function countSkipped(rawArray: unknown, kept: number): number {
	return Array.isArray(rawArray) ? rawArray.length - kept : 0;
}

/**
 * Parses + validates a backup file and reports the rejected rows.
 * Tolerant of partially corrupted entries (filters out invalid rows rather
 * than rejecting everything), but strict on the envelope (`format`,
 * `schemaVersion`). The `skipped` count makes it possible to warn the user of a
 * partial restore.
 *
 * @throws {BackupParseError} invalid JSON, unexpected format, or future version.
 */
export function parseBackupWithReport(json: string): ParsedBackup {
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
	const drafts = Array.isArray(raw.drafts) ? raw.drafts.filter(validDraft) : [];
	const workspaces = Array.isArray(raw.workspaces) ? raw.workspaces.filter(validWorkspace) : [];
	const templates = Array.isArray(raw.templates) ? raw.templates.filter(validTemplate) : [];
	return {
		backup: {
			format: BACKUP_FORMAT,
			schemaVersion,
			exportedAt: typeof raw.exportedAt === 'number' ? raw.exportedAt : 0,
			drafts,
			workspaces,
			templates
		},
		skipped: {
			drafts: countSkipped(raw.drafts, drafts.length),
			workspaces: countSkipped(raw.workspaces, workspaces.length),
			templates: countSkipped(raw.templates, templates.length)
		}
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
 * - `merge`   : keeps the existing data; ids already present are overwritten
 *               (keeping their current `order` so as not to reorder open
 *               tabs), new drafts are APPENDED at the end
 *               (order = existing max + 1, +2, …) to avoid `order` index
 *               collisions.
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
	await db.transaction('rw', db.drafts, db.workspaces, db.templates, db.versions, async () => {
		if (mode === 'replace') {
			// `replace` starts from a clean state: we also clear the version
			// history (the backup contains none), otherwise orphan snapshots of
			// old drafts survive and leak the quota.
			await Promise.all([
				db.drafts.clear(),
				db.workspaces.clear(),
				db.templates.clear(),
				db.versions.clear()
			]);
			await Promise.all([
				db.drafts.bulkPut(backup.drafts),
				db.workspaces.bulkPut(backup.workspaces),
				db.templates.bulkPut(backup.templates)
			]);
			return;
		}
		// merge
		const existing = await db.drafts.toArray();
		const currentOrderById = new Map(existing.map((d) => [d.id, d.order]));
		let maxOrder = existing.reduce((m, d) => Math.max(m, d.order), -1);
		const draftsToPut = backup.drafts.map((d) => {
			const keep = currentOrderById.get(d.id);
			// Id already present → we replace the content but keep the current
			// `order` (do not reorder open tabs). New id → appended at the end
			// (strictly increasing order to avoid collisions).
			return keep !== undefined ? { ...d, order: keep } : { ...d, order: ++maxOrder };
		});
		await Promise.all([
			db.drafts.bulkPut(draftsToPut),
			db.workspaces.bulkPut(backup.workspaces),
			db.templates.bulkPut(backup.templates)
		]);
	});
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
	try {
		const { isDesktop } = await import('../desktop');
		if (isDesktop()) {
			const { tauriSaveExportBlob } = await import('../disk-tauri');
			return await tauriSaveExportBlob(blob, filename);
		}
	} catch {
		// fall through to browser download
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
	const stamp = new Date(now).toISOString().slice(0, 10);
	if (passphrase) {
		const envelope = await encryptString(json, passphrase);
		const blob = new Blob([JSON.stringify(envelope)], { type: 'application/json;charset=utf-8' });
		return triggerDownload(blob, `mdsh-backup-${stamp}.encrypted.json`);
	}
	const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
	return triggerDownload(blob, `mdsh-backup-${stamp}.json`);
}

/** §2.8 - Detects whether a backup text is an encrypted envelope. */
export function isEncryptedBackup(text: string): boolean {
	try {
		return isEncryptedEnvelope(JSON.parse(text));
	} catch {
		return false;
	}
}

/** §2.8 - Decrypts a backup envelope → plaintext JSON. */
export async function decryptBackupText(text: string, passphrase: string): Promise<string> {
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
	return restoreFromText(await file.text(), mode, passphrase);
}
