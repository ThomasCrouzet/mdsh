import { db } from './db';
import { deleteHandle, getPathLink, listDiskLinks } from './fsa';
import { tauriForgetPath } from './disk-tauri';

let cleanupTail = Promise.resolve();

/** Removes a native disk link after its document leaves the trash. */
export function deleteUnownedDiskLink(id: string): Promise<void> {
	// Process links in order so the last shared link revokes the native grant.
	const cleanup = cleanupTail.then(async () => {
		const hasOwner = await db.transaction('r', db.drafts, db.trashed, async () => {
			return Boolean((await db.drafts.get(id)) ?? (await db.trashed.get(id)));
		});
		if (hasOwner) return;

		const link = await getPathLink(id);
		if (link) {
			const shared = (await listDiskLinks()).some(
				(other) => other.id !== id && other.kind === 'path' && other.path === link.path
			);
			// Keep the path record if native cleanup fails. Disk links can retry it.
			if (!shared) await tauriForgetPath(link.path);
		}
		await deleteHandle(id);
	});
	// A failed link must not block later cleanup. The caller reports the error.
	cleanupTail = cleanup.catch(() => {});
	return cleanup;
}
