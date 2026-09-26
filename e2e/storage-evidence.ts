import { expect, type Page } from '@playwright/test';
import type { DraftRow, TrashedRow, VersionRow, WorkspaceRow } from '../src/lib/db';

interface StorageState {
	drafts: DraftRow[];
	versions: VersionRow[];
	trashed: TrashedRow[];
	workspaces: WorkspaceRow[];
	metadata: unknown[];
	templates: unknown[];
}

export async function databaseState(page: Page) {
	return page.evaluate(
		() =>
			new Promise<StorageState>((resolve, reject) => {
				const request = indexedDB.open('mdsh');
				request.onerror = () => reject(request.error);
				request.onsuccess = () => {
					const db = request.result;
					const tables = ['drafts', 'versions', 'trashed', 'workspaces', 'metadata', 'templates'];
					const tx = db.transaction(tables);
					const reads = tables.map((table) => tx.objectStore(table).getAll());
					tx.oncomplete = () => {
						db.close();
						resolve(
							Object.fromEntries(
								tables.map((table, index) => [table, reads[index]!.result])
							) as StorageState
						);
					};
					tx.onabort = () => {
						db.close();
						reject(tx.error);
					};
				};
			})
	);
}

export async function editWithoutWaiting(page: Page, content: string) {
	await page.locator('button[data-mode="source"]').click();
	await page.locator('.cm-content').click();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.insertText(content);
}

export async function importBackup(page: Page, backup: unknown) {
	await page.keyboard.press('ControlOrMeta+,');
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: 'Importer une sauvegarde…' }).click();
	await (
		await chooser
	).setFiles({
		name: 'fixture.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(backup))
	});
	const prompt = page.getByRole('dialog', { name: 'Restaurer la sauvegarde' });
	await expect(prompt).toBeVisible();
	await prompt.getByRole('button', { name: 'Remplacer', exact: true }).click();
}

export async function deferSaveTimer(page: Page) {
	await page.evaluate(() => {
		const timeout = window.setTimeout;
		window.setTimeout = ((handler: TimerHandler, ms?: number, ...args: unknown[]) =>
			timeout(handler, ms === 400 ? 60_000 : ms, ...args)) as typeof window.setTimeout;
	});
}
