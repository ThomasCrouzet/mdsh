import { browser } from '$app/environment';
import { db, newId } from './db';
import type { DraftRow } from './db';
import type { FileItem, TrashedFile } from './types';
import { TIMERS } from './config';
import { isFSASupported, getHandle, getPathLink, pickDirectoryFiles } from './fsa';
import { isDesktop } from './desktop';
import {
	loadTrashRows,
	moveToTrash,
	restoreFromTrash,
	purgePermanently,
	persistReorder
} from './trash';
import {
	openFromDisk as diskOpenFromDisk,
	openPathsFromDesktop as diskOpenPathsFromDesktop,
	saveToDisk as diskSaveToDisk,
	unlinkFromDisk as diskUnlinkFromDisk,
	refreshBrokenLinks as diskRefreshBrokenLinks
} from './disk-sync';
import { isMarkdownFile, normalizeRename, uniqueName } from './file-utils';
import {
	exportMarkdown as exportMarkdownOp,
	exportAllZip as exportAllZipOp,
	exportHTML as exportHTMLOp,
	exportPDF as exportPDFOp,
	exportSelectionZip as exportSelectionZipOp
} from './export-ops';
import { MetaIndex } from './meta-index';
import { SaveQueue } from './save-queue';
import { reportPersistenceError } from './storage';
import { reportError, reportWarning } from './report';
import { recordVersion, deleteVersionsFor } from './version-history';
import { replaceInFiles, type ReplaceOptions } from './replace';
import { createCrossTab, type CrossTabMessage } from './cross-tab';
import { t } from '$lib/i18n';
import { notify } from './notify.svelte';
import { DEMO_DOCS } from './demo-doc';
import { toggleSelection, rangeSelection, clearSelection } from './selection';

const ACTIVE_ID_KEY = 'mdsh:activeId';

function toDraftRow(file: FileItem, order: number): DraftRow {
	return {
		id: file.id,
		name: file.name,
		content: file.content,
		createdAt: file.createdAt,
		updatedAt: file.updatedAt,
		order
	};
}

class FilesStore {
	files = $state<FileItem[]>([]);
	activeId = $state<string | null>(null);
	loaded = $state(false);
	// §J1 - Error message if IndexedDB access fails at startup (private mode,
	// storage disabled, corrupted profile). Shown as a banner by +page.
	loadError = $state<string | null>(null);
	lastSavedAt = $state<number>(0);
	trash = $state<TrashedFile[]>([]);
	// §B3.2 - `true` during the debounce (400 ms) + the IDB write. Shown by StatusBar.
	hasPendingSave = $state(false);
	// §6.5 - Always reassigned (new Set) - Svelte 5 does not track in-place mutations.
	selectedIds = $state<Set<string>>(new Set());

	private trashTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private metaIndex = new MetaIndex(() => this.files);
	// §M3 - Ids with a local keystroke not yet persisted ("dirty") in the
	// cross-tab sense: a draft is dirty as long as a write is pending OR its
	// in-memory content differs from the last known base. Used to decide, when
	// receiving a message from another tab, between reloading (safe) and notifying
	// a conflict (local editing in progress, do not overwrite).
	private crossTab = createCrossTab((msg) => this.handleCrossTabMessage(msg));
	private saveQueue = new SaveQueue({
		onPendingChange: (pending) => {
			this.hasPendingSave = pending;
		},
		onSaved: (ts) => {
			this.lastSavedAt = ts;
		},
		onError: (err) => reportPersistenceError(err, 'save'),
		// §M3 - After each successful write, we publish to the other tabs so they
		// resynchronize this draft (and do not overwrite our write).
		onDraftSaved: (id, updatedAt) => {
			this.crossTab.post({ type: 'draft-written', id, updatedAt });
		}
	});

	get active(): FileItem | null {
		return this.files.find((f) => f.id === this.activeId) ?? null;
	}

	/**
	 * §M3 - Receives a message from ANOTHER tab (never from the sender:
	 * BroadcastChannel does not echo back to itself → no loop).
	 *
	 * Conservative policy, no auto-merge:
	 *  - `draft-written`: if the draft is loaded here AND not "dirty" (no local
	 *    write pending), we reload its row from Dexie to reflect the other tab and
	 *    NOT overwrite it. If it is dirty (real concurrent editing conflict), we do
	 *    NOT reload (we would lose the local keystroke) but we notify the user of
	 *    the conflict.
	 *  - `removed`: if we still have the tab open and no local editing is in
	 *    progress, we remove it from the view (the row no longer exists in base).
	 *  - `reorder` / `backup-applied`: we resynchronize the whole state from Dexie
	 *    via `reload()` (unless local editing is in progress, in which case we notify).
	 *
	 * Everything is defensive and fire-and-forget: this path must NEVER cause data
	 * loss or a reload loop.
	 */
	private handleCrossTabMessage(msg: CrossTabMessage): void {
		if (!browser) return;
		if (msg.type === 'draft-written') {
			void this.syncDraftFromOtherTab(msg.id);
		} else if (msg.type === 'removed') {
			this.syncRemovalFromOtherTab(msg.id);
		} else if (msg.type === 'reorder' || msg.type === 'backup-applied') {
			// A tab reordered or restored a backup: if no local editing is in
			// progress, we reload everything to stay consistent. Otherwise we notify
			// (a reload would overwrite the unflushed local keystroke).
			if (this.hasLocalPendingEdits()) {
				this.notifyCrossTabConflict(t('files.otherTabChanges'));
			} else {
				// `reload(false)`: do NOT re-broadcast (otherwise an infinite reload
				// loop between tabs).
				void this.reload(false);
				if (msg.type === 'backup-applied') {
					// A backup restored in another tab rewrites the three tables
					// (drafts + workspaces + templates). We also resynchronize the
					// sibling stores, otherwise their in-memory rows stay stale and
					// could re-overwrite the freshly restored data. Dynamic import:
					// `workspaces`/`templates` import `filesStore` (cycle).
					void import('./workspaces.svelte').then((m) => m.workspaceStore.reload());
					void import('./templates.svelte').then((m) => m.templatesStore.reload());
				}
			}
		}
	}

	/** §M3 - Is there at least one draft with a local write pending? */
	private hasLocalPendingEdits(): boolean {
		return this.files.some((f) => this.saveQueue.has(f.id));
	}

	/**
	 * §M3 - Conflict toast with an explicit reload action so the user can
	 * discard the local unflushed edit and resync from IndexedDB when ready.
	 */
	private notifyCrossTabConflict(message: string): void {
		notify.actionable(message, {
			label: t('files.reloadFromStorage'),
			run: () => {
				void this.reload(false);
			}
		});
	}

	/** §M3 - Reloads a specific draft from Dexie after it was written by another tab. */
	private async syncDraftFromOtherTab(id: string): Promise<void> {
		const file = this.files.find((f) => f.id === id);
		if (!file) return; // not loaded here → nothing to resynchronize
		// Local editing pending on this file: real conflict. We do NOT reload (we
		// would lose the local keystroke) - we signal the conflict to the user.
		if (this.saveQueue.has(id)) {
			this.notifyCrossTabConflict(t('files.modifiedInOtherTab', { name: file.name }));
			return;
		}
		try {
			const row = await db.drafts.get(id);
			if (!row) return;
			// Re-check the absence of local editing AFTER the await (a keystroke may
			// have arrived in the meantime): if it became dirty, we abstain.
			if (this.saveQueue.has(id)) return;
			file.name = row.name;
			file.content = row.content;
			file.updatedAt = row.updatedAt;
			file.dirty = false;
			this.metaIndex.invalidateMeta(id);
		} catch (err) {
			reportError('cross-tab resync', err);
		}
	}

	/** §M3 - Another tab deleted/trashed a draft: removes the local tab if safe. */
	private syncRemovalFromOtherTab(id: string): void {
		const file = this.files.find((f) => f.id === id);
		if (!file) return;
		// Local editing in progress on this file: do not make it disappear under
		// the user's fingers - we only notify.
		if (this.saveQueue.has(id)) {
			this.notifyCrossTabConflict(t('files.deletedInOtherTab', { name: file.name }));
			return;
		}
		// Pure removal from the view (the row already disappeared from Dexie on the
		// other tab); keepDB so we do not re-trigger a DB deletion here.
		this.close(id, { trash: false, keepDB: true });
	}

	async load(): Promise<void> {
		if (!browser || this.loaded) return;
		try {
			const rows = await db.drafts.orderBy('order').toArray();
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Set transient local (jamais un $state)
			const linkedIds = new Set<string>();
			if (isFSASupported() || isDesktop()) {
				// Promise.all: N handles/paths in parallel (avoids ~500 ms of sequential IDB blocking).
				const checks = await Promise.all(
					rows.map(async (r) => {
						const hasFsa = isFSASupported() ? Boolean(await getHandle(r.id)) : false;
						const hasPath = Boolean(await getPathLink(r.id));
						return { id: r.id, has: hasFsa || hasPath };
					})
				);
				for (const c of checks) if (c.has) linkedIds.add(c.id);
			}
			this.files = rows.map((r) => ({
				id: r.id,
				name: r.name,
				content: r.content,
				createdAt: r.createdAt,
				updatedAt: r.updatedAt,
				dirty: false,
				linkedToDisk: linkedIds.has(r.id)
			}));
			const savedActiveId = localStorage.getItem(ACTIVE_ID_KEY);
			if (savedActiveId && this.files.some((f) => f.id === savedActiveId)) {
				this.activeId = savedActiveId;
			} else if (this.files.length > 0) {
				// invariant: files[0] is guaranteed non-undefined since length > 0.
				this.activeId = this.files[0]!.id;
			}
			await this.loadTrash();
			this.loaded = true;
			// Background FSA check - no await (must not block the display).
			void this.refreshBrokenLinks();
		} catch (err) {
			// §J1 - IndexedDB inaccessible (private browsing, storage disabled,
			// corrupted profile): we do not abandon the app on a misleading empty
			// screen ("no files"), we surface an actionable message.
			reportError('chargement IndexedDB', err);
			this.loadError = t('files.loadError');
		}
	}

	/**
	 * §1.1 - Reloads the whole state from Dexie (after a backup restoration, which
	 * rewrote the tables under our feet). Cancels the in-progress saves and timers,
	 * empties the in-memory state, then re-reads as at startup.
	 *
	 * §M3 - `broadcast` (default true) publishes a `backup-applied` signal to the
	 * other tabs so they resynchronize. Set to `false` when the reload is itself
	 * triggered by a cross-tab message (avoids the infinite loop).
	 */
	async reload(broadcast = true): Promise<void> {
		if (!browser) return;
		this.saveQueue.cancelAll(this.files.map((f) => f.id));
		for (const t of this.trashTimers.values()) clearTimeout(t);
		this.trashTimers.clear();
		this.files = [];
		this.trash = [];
		this.activeId = null;
		this.selectedIds = new Set();
		this.loaded = false;
		this.loadError = null;
		await this.load();
		if (broadcast) this.crossTab.post({ type: 'backup-applied' });
	}

	/** Reloads the trash from Dexie, purges expired entries, restarts the timers. */
	private async loadTrash(): Promise<void> {
		const results = await loadTrashRows();
		for (const { entry, remainingMs } of results) {
			this.trash.push(entry);
			const timer = setTimeout(() => this.purge(entry.file.id), remainingMs);
			this.trashTimers.set(entry.file.id, timer);
		}
	}

	private persistActiveId(): void {
		if (!browser) return;
		if (this.activeId) localStorage.setItem(ACTIVE_ID_KEY, this.activeId);
		else localStorage.removeItem(ACTIVE_ID_KEY);
	}

	/** Schedules the Dexie persistence of `id` after 400 ms (debounce via SaveQueue). */
	private scheduleSave(id: string): void {
		this.saveQueue.schedule(id, () => {
			const file = this.files.find((f) => f.id === id);
			if (!file) return null;
			// §2.4 - History snapshot at flush time (throttled + deduplicated in
			// recordVersion). Fire-and-forget: does not block the save; a history
			// failure must not compromise the save.
			void recordVersion({ id: file.id, name: file.name, content: file.content }).catch((err) =>
				reportError('historique de version', err)
			);
			return toDraftRow(file, this.files.indexOf(file));
		});
	}

	/** §A2.8 - Immediate flush of pending saves (pagehide / beforeunload). */
	flushPending(): void {
		this.saveQueue.flush((id) => {
			const file = this.files.find((f) => f.id === id);
			if (!file) return null;
			// §M2 - History snapshot also on the close flush. The `scheduleSave`
			// debounce path already records a version, but not the
			// pagehide/beforeunload flush: combined with the 5 min throttle, the last
			// state before closing could have never had a version. `recordVersion`
			// handles its own throttle/dedup → no abusive duplicate. Fire-and-forget.
			void recordVersion({ id: file.id, name: file.name, content: file.content }).catch((err) =>
				reportError('historique de version', err)
			);
			return toDraftRow(file, this.files.indexOf(file));
		});
	}

	createNew(name = t('files.untitledFilename'), content = ''): FileItem {
		const file: FileItem = {
			id: newId(),
			name: uniqueName(
				this.files.map((f) => f.name),
				name
			),
			content,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			dirty: content.length > 0
		};
		this.files.push(file);
		this.activeId = file.id;
		this.persistActiveId();
		if (content.length > 0) this.metaIndex.invalidateBacklinksIndex();
		this.scheduleSave(file.id);
		return file;
	}

	/**
	 * Imports files: creates one tab per recognized markdown file.
	 *
	 * §#6 - Non-markdown entries are counted (`skipped`) so the caller can report
	 * "no markdown file recognized" rather than leaving a .pdf/.docx drop with no
	 * visible feedback.
	 *
	 * §D - Per-file protected read: if `f.text()` rejects (file became unreadable
	 * between selection and reading), we log and skip that file without
	 * interrupting the loop (the following ones are still imported).
	 */
	async importFiles(
		fileList: FileList | File[]
	): Promise<{ created: FileItem[]; skipped: number; failed: number }> {
		const arr = Array.from(fileList);
		const created: FileItem[] = [];
		let skipped = 0;
		let failed = 0;
		for (const f of arr) {
			if (!isMarkdownFile(f)) {
				skipped += 1;
				continue;
			}
			let content: string;
			try {
				content = await f.text();
			} catch (err) {
				// §D - An unreadable file must not fail the whole import.
				reportError(`import du fichier « ${f.name} »`, err);
				failed += 1;
				continue;
			}
			const name = f.name.endsWith('.md') || f.name.endsWith('.markdown') ? f.name : `${f.name}.md`;
			created.push(this.createNew(name, content));
		}
		return { created, skipped, failed };
	}

	setActive(id: string): void {
		this.activeId = id;
		this.persistActiveId();
	}

	close(id: string, opts: { trash?: boolean; keepDB?: boolean } = {}): void {
		const idx = this.files.findIndex((f) => f.id === id);
		if (idx === -1) return;
		// invariant: splice on a valid index (idx !== -1) returns exactly 1 element.
		const file = this.files.splice(idx, 1)[0]!;
		if (this.activeId === id) {
			this.activeId = this.files[Math.min(idx, this.files.length - 1)]?.id ?? null;
			this.persistActiveId();
		}
		this.saveQueue.cancel(id);
		this.metaIndex.invalidateMeta(id);
		if (this.selectedIds.has(id)) {
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- reassigning the $state with a fresh Set (deliberate Svelte 5 pattern, cf. selectionToggle)
			const next = new Set(this.selectedIds);
			next.delete(id);
			this.selectedIds = next;
		}
		if (opts.trash !== false) {
			const trashedAt = Date.now();
			const entry: TrashedFile = { file, order: idx, trashedAt };
			this.trash.push(entry);
			const timer = setTimeout(() => this.purge(id), TIMERS.trashUndoMs);
			this.trashTimers.set(id, timer);
			void moveToTrash(id, toDraftRow(file, idx), idx, trashedAt).then((ok) => {
				if (ok) {
					// §M3 - The `drafts` row left the base (moved to trash): signals the
					// other tabs to remove the corresponding tab.
					this.crossTab.post({ type: 'removed', id });
				} else {
					// The trash write failed (transaction rollback on the Dexie side, the
					// draft is still in base): we cancel the optimistic mutation so the UI
					// does not lie about a "closed" but not trashed file.
					this.rollbackTrash(id, file, idx);
				}
			});
		} else if (opts.keepDB === true) {
			// §6.8 - keepDB: removes the tab without deleting the draft (workspaces.restore).
			// No broadcast: the row stays in base, nothing to resynchronize elsewhere.
		} else {
			db.drafts.delete(id).catch((err) => reportPersistenceError(err, 'delete'));
			// §2.4 - Hard deletion: also purges the version history.
			void deleteVersionsFor(id).catch((err) =>
				reportWarning('suppression historique de versions', err)
			);
			// §M3 - Hard deletion of the row: signals the other tabs.
			this.crossTab.post({ type: 'removed', id });
		}
	}

	/**
	 * §6.8 - Closes several tabs. `keepDB: true` preserves the drafts in DB
	 * (workspaces.restore); `trash: false` without keepDB = hard deletion.
	 */
	closeMany(ids: string[], opts: { trash?: boolean; keepDB?: boolean } = {}): void {
		const toClose = ids.filter((id) => this.files.some((f) => f.id === id));
		if (toClose.length === 0) return;
		for (const id of toClose) this.close(id, opts);
	}

	/**
	 * §6.8 - Re-injects Dexie rows into `files` without recreating them (workspaces.restore).
	 * No scheduleSave: the rows already exist in DB.
	 */
	openMany(rows: DraftRow[]): void {
		if (!browser || rows.length === 0) return;
		const existing = new Set(this.files.map((f) => f.id));
		let added = false;
		for (const r of rows) {
			if (!r || existing.has(r.id)) continue;
			this.files.push({
				id: r.id,
				name: r.name,
				content: r.content,
				createdAt: r.createdAt,
				updatedAt: r.updatedAt,
				dirty: false,
				linkedToDisk: false
			});
			added = true;
		}
		if (added) this.metaIndex.invalidateBacklinksIndex();
	}

	restore(id: string): FileItem | null {
		const idx = this.trash.findIndex((t) => t.file.id === id);
		if (idx === -1) return null;
		// invariant: splice on a valid index returns exactly 1 element.
		const entry = this.trash.splice(idx, 1)[0]!;
		const insertAt = Math.min(entry.order, this.files.length);
		this.files.splice(insertAt, 0, entry.file);
		this.activeId = entry.file.id;
		this.persistActiveId();
		const t = this.trashTimers.get(id);
		if (t) {
			clearTimeout(t);
			this.trashTimers.delete(id);
		}
		this.metaIndex.invalidateBacklinksIndex();
		// Atomic restoration (put draft + delete trashed in one transaction): no
		// window where the file exists in NO table. Since the row is persisted, no
		// scheduleSave here (later edits will go back through the normal path).
		void restoreFromTrash(id, toDraftRow(entry.file, insertAt));
		return entry.file;
	}

	/**
	 * Cancels the optimistic move-to-trash when the Dexie write failed: re-inserts
	 * the file into the view, removes the trash entry and the purge timer. The
	 * draft is still in base (Dexie transaction rollback), so the view becomes
	 * consistent with storage again.
	 */
	private rollbackTrash(id: string, file: FileItem, idx: number): void {
		const tIdx = this.trash.findIndex((t) => t.file.id === id);
		if (tIdx !== -1) this.trash.splice(tIdx, 1);
		const timer = this.trashTimers.get(id);
		if (timer) {
			clearTimeout(timer);
			this.trashTimers.delete(id);
		}
		if (!this.files.some((f) => f.id === id)) {
			this.files.splice(Math.min(idx, this.files.length), 0, file);
			this.metaIndex.invalidateBacklinksIndex();
		}
	}

	private purge(id: string): void {
		const idx = this.trash.findIndex((t) => t.file.id === id);
		if (idx === -1) return;
		this.trash.splice(idx, 1);
		this.trashTimers.delete(id);
		// purgePermanently clears trashed + FSA handle + version history.
		void purgePermanently(id);
	}

	updateContent(id: string, content: string): void {
		const file = this.files.find((f) => f.id === id);
		if (!file || file.content === content) return;
		file.content = content;
		file.updatedAt = Date.now();
		file.dirty = true;
		this.metaIndex.invalidateMeta(id);
		this.scheduleSave(id);
	}

	rename(id: string, name: string): void {
		const file = this.files.find((f) => f.id === id);
		if (!file) return;
		file.name = normalizeRename(name);
		file.updatedAt = Date.now();
		this.metaIndex.invalidateMeta(id);
		this.scheduleSave(id);
	}

	// ─── Exports (delegation → export-ops.ts) ────────────────────────────────

	private get exportDeps() {
		return {
			getFiles: () => this.files,
			scheduleSave: (id: string) => this.scheduleSave(id)
		};
	}

	exportActive(): void {
		if (this.active) this.export(this.active.id);
	}
	export(id: string): void {
		exportMarkdownOp(id, this.exportDeps);
	}
	async exportAll(): Promise<void> {
		return exportAllZipOp(this.exportDeps);
	}
	async exportHTML(id: string): Promise<void> {
		return exportHTMLOp(id, this.exportDeps);
	}
	async exportActiveHTML(): Promise<void> {
		if (this.active) await this.exportHTML(this.active.id);
	}
	async exportPDF(id: string): Promise<void> {
		return exportPDFOp(id, this.exportDeps);
	}
	async exportActivePDF(): Promise<void> {
		if (this.active) await this.exportPDF(this.active.id);
	}
	async exportSelectedZip(): Promise<void> {
		return exportSelectionZipOp(this.selectedIds, this.exportDeps);
	}

	// §4.5 / §M1 - Drag-reorder.
	// The in-memory array is reordered first (→ `indexOf` gives the NEW order),
	// then we FLUSH the pending content (instead of cancelling it) with this new
	// `order`: `cancelAll` destroyed the pending timers without writing, losing the
	// last pre-reorder keystroke in base. `persistReorder` then touches ONLY the
	// `order` field (db.drafts.update), so the freshly flushed content is never
	// overwritten.
	reorder(fromId: string, toId: string): void {
		const fromIdx = this.files.findIndex((f) => f.id === fromId);
		const toIdx = this.files.findIndex((f) => f.id === toId);
		if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
		// invariant: splice on a valid index returns exactly 1 element.
		const moved = this.files.splice(fromIdx, 1)[0]!;
		this.files.splice(toIdx, 0, moved);
		const orderedIds = this.files.map((f) => f.id);
		this.saveQueue.flushPending(orderedIds, (id) => {
			const file = this.files.find((f) => f.id === id);
			if (!file) return null;
			return toDraftRow(file, this.files.indexOf(file));
		});
		void persistReorder(orderedIds).then((ts) => {
			// ts === null: the order write failed (already notified by
			// reportPersistenceError). We do NOT show "saved" and we do not propagate
			// to the other tabs - nothing was persisted.
			if (ts === null) return;
			this.lastSavedAt = ts;
			// §M3 - Informs the other tabs that the order changed in base.
			this.crossTab.post({ type: 'reorder' });
		});
	}

	// ─── Disk sync (delegation → disk-sync.ts) ───────────────────────────────

	private get diskDeps() {
		return {
			getFile: (id: string) => this.files.find((f) => f.id === id),
			onCreate: (name: string, content: string) => this.createNew(name, content),
			scheduleSave: (id: string) => this.scheduleSave(id)
		};
	}

	async openFromDisk(): Promise<FileItem[]> {
		return diskOpenFromDisk(this.diskDeps);
	}

	/** Desktop: open absolute paths from argv / file association. */
	async openPathsFromDesktop(paths: string[]): Promise<FileItem[]> {
		return diskOpenPathsFromDesktop(paths, this.diskDeps);
	}

	/**
	 * §2.3 - "Vault" import: opens a folder and creates one tab per markdown file
	 * found (recursive, capped). The files are NOT linked to disk (one-shot import)
	 * - they become normal local drafts, which resolves the inter-file wiki-links
	 * via the existing MetaIndex.
	 */
	async importDirectory(): Promise<{ count: number; truncated: boolean }> {
		if (!browser) return { count: 0, truncated: false };
		const { files, truncated } = await pickDirectoryFiles();
		for (const f of files) this.createNew(f.name, f.content);
		return { count: files.length, truncated };
	}

	/**
	 * §P1.9 - Opt-in guided tour: creates the demo files (wiki-linked, showing
	 * off backlinks and the link graph) and activates the first one. Never
	 * called automatically - only from the explicit Welcome-screen button.
	 */
	loadDemo(): FileItem[] {
		const created = DEMO_DOCS.map((doc) => this.createNew(doc.name, doc.content));
		// invariant: DEMO_DOCS is a non-empty const array, `created` has the same length.
		this.setActive(created[0]!.id);
		return created;
	}

	/**
	 * §2.6 - Cross-file replacement. Applies `replacement` to all occurrences of
	 * `query` (according to `opts`) in all open files, via `updateContent` (which
	 * marks dirty, schedules the save AND records a history snapshot → undoable via
	 * the version history). Returns the number of affected files + occurrences, or
	 * a regex error.
	 */
	replaceInAll(
		query: string,
		replacement: string,
		opts: ReplaceOptions
	): { files: number; occurrences: number; regexError: string | null } {
		const slices = this.files.map((f) => ({ id: f.id, name: f.name, content: f.content }));
		const { results, total, regexError } = replaceInFiles(slices, query, replacement, opts);
		if (regexError) return { files: 0, occurrences: 0, regexError };
		for (const r of results) this.updateContent(r.id, r.content);
		return { files: results.length, occurrences: total, regexError: null };
	}
	async saveActiveToDisk(): Promise<boolean> {
		if (!browser || !this.active) return false;
		return this.saveToDisk(this.active.id);
	}
	async saveToDisk(id: string): Promise<boolean> {
		return diskSaveToDisk(id, this.diskDeps);
	}
	async unlinkFromDisk(id: string): Promise<void> {
		return diskUnlinkFromDisk(id, this.diskDeps);
	}
	async refreshBrokenLinks(): Promise<void> {
		return diskRefreshBrokenLinks(this.files, (id) => this.files.find((f) => f.id === id));
	}

	// ─── MetaIndex (delegation → meta-index.ts) ──────────────────────────────

	/** Front-matter tags of file `id`. */
	getTags(id: string): string[] {
		return this.metaIndex.getTags(id);
	}
	/** All unique tags of the corpus, sorted alphabetically. */
	get allTags(): string[] {
		return this.metaIndex.allTags;
	}
	/** Title: front-matter `title` > first H1 (if FM present) > filename without extension. */
	displayTitle(id: string): string {
		return this.metaIndex.displayTitle(id);
	}
	/** Files that contain a wiki-link pointing to `targetId`. */
	backlinks(targetId: string): FileItem[] {
		return this.metaIndex.backlinks(targetId);
	}
	/** Resolves a wiki-link → file id, or `null` if not found. */
	resolveWikiLink(target: string): string | null {
		return this.metaIndex.resolveWikiLink(target);
	}
	/**
	 * Opens a wiki-link target: activates the existing file, or creates a new one
	 * (Obsidian behavior). Returns the resolved/created id.
	 */
	openWikiLink(target: string): string | null {
		const resolved = this.resolveWikiLink(target);
		if (resolved) {
			this.setActive(resolved);
			return resolved;
		}
		const trimmed = target.trim();
		if (!trimmed) return null;
		return this.createNew(`${trimmed}.md`).id;
	}
	/** @internal - outgoing wiki-link targets of file `id`. */
	wikiLinkTargets(id: string): string[] {
		return this.metaIndex.wikiLinkTargets(id);
	}

	// ─── Sidebar multi-selection (§6.5) ──────────────────────────────────────
	// Always new Set() - Svelte 5 does not track in-place mutations.
	// Pure logic lives in `selection.ts` (unit-tested without the store).

	/** Cmd/Ctrl+click: adds/removes `id` from the selection. */
	selectionToggle(id: string): void {
		this.selectedIds = toggleSelection(this.selectedIds, id);
	}
	/** Shift+click: selects the range between `anchorId` and `targetId`. */
	selectionRange(anchorId: string, targetId: string): void {
		this.selectedIds = rangeSelection(
			this.selectedIds,
			this.files.map((f) => f.id),
			anchorId,
			targetId
		);
	}
	/** Clears the selection. */
	selectionClear(): void {
		this.selectedIds = clearSelection();
	}
	/** Closes all selected files + clears the selection. */
	closeSelected(): void {
		const ids = Array.from(this.selectedIds);
		for (const id of ids) this.close(id);
		this.selectedIds = clearSelection();
	}
}

export const filesStore = new FilesStore();
