import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, newId, type WorkspaceRow } from './db';

// Tests workspace : ciblent la couche persistance Dexie (table `workspaces`,
// schéma v3) plutôt que le singleton `workspaceStore` (qui utilise des runes
// `$state` non transformées par le runner Vitest sans plugin Svelte). La logique
// métier (save/load/rename/delete + restore via filesStore) est couverte par
// les E2E ; ici on garantit le contrat DB : index par updatedAt, persistance
// du tableau fileIds, conservation de l'activeId, identification par id.
//
// L'objectif est de cadenasser le schéma : si quelqu'un bumpe la version Dexie
// sans migration, ces tests cassent immédiatement (la table workspaces doit
// toujours être présente avec son index `updatedAt`).

beforeEach(async () => {
	await db.workspaces.clear();
});

afterEach(async () => {
	await db.workspaces.clear();
});

function makeRow(partial: Partial<WorkspaceRow> = {}): WorkspaceRow {
	const now = Date.now();
	return {
		id: partial.id ?? newId(),
		name: partial.name ?? 'Test',
		fileIds: partial.fileIds ?? [],
		activeId: partial.activeId ?? null,
		createdAt: partial.createdAt ?? now,
		updatedAt: partial.updatedAt ?? now
	};
}

describe('db.workspaces - schéma v3', () => {
	it('démarre vide', async () => {
		const all = await db.workspaces.toArray();
		expect(all).toEqual([]);
	});

	it('persiste un workspace avec fileIds + activeId', async () => {
		const aId = newId();
		const bId = newId();
		const row = makeRow({
			name: 'Notes meeting',
			fileIds: [aId, bId],
			activeId: aId
		});
		await db.workspaces.put(row);

		const got = await db.workspaces.get(row.id);
		expect(got?.name).toBe('Notes meeting');
		expect(got?.fileIds).toEqual([aId, bId]);
		expect(got?.activeId).toBe(aId);
	});

	it('peut stocker un activeId null (workspace sans onglet actif)', async () => {
		const row = makeRow({ activeId: null });
		await db.workspaces.put(row);
		const got = await db.workspaces.get(row.id);
		expect(got?.activeId).toBeNull();
	});

	it("liste les workspaces triés par updatedAt desc (récents d'abord)", async () => {
		const r1 = makeRow({ name: 'A', updatedAt: 1000 });
		const r2 = makeRow({ name: 'B', updatedAt: 3000 });
		const r3 = makeRow({ name: 'C', updatedAt: 2000 });
		await db.workspaces.bulkPut([r1, r2, r3]);

		const ordered = await db.workspaces.orderBy('updatedAt').reverse().toArray();
		expect(ordered.map((w) => w.name)).toEqual(['B', 'C', 'A']);
	});

	it('put() override le workspace existant (rename + update)', async () => {
		const row = makeRow({ name: 'Avant', updatedAt: 1000 });
		await db.workspaces.put(row);

		const updated = { ...row, name: 'Après', updatedAt: 2000 };
		await db.workspaces.put(updated);

		const got = await db.workspaces.get(row.id);
		expect(got?.name).toBe('Après');
		expect(got?.updatedAt).toBe(2000);

		// Une seule entrée reste (pas de doublons à id constant).
		const all = await db.workspaces.toArray();
		expect(all).toHaveLength(1);
	});

	it("delete() retire l'entrée", async () => {
		const row = makeRow({ name: 'À jeter' });
		await db.workspaces.put(row);
		expect(await db.workspaces.get(row.id)).not.toBeUndefined();

		await db.workspaces.delete(row.id);
		expect(await db.workspaces.get(row.id)).toBeUndefined();
	});

	it('delete() sur id inexistant ne throw pas', async () => {
		await expect(db.workspaces.delete('does-not-exist')).resolves.toBeUndefined();
	});

	it("préserve l'ordre des fileIds (clé pour la restauration de session)", async () => {
		const ids = ['z', 'a', 'm', 'b'];
		const row = makeRow({ fileIds: ids });
		await db.workspaces.put(row);
		const got = await db.workspaces.get(row.id);
		// L'ordre est sémantique : c'est l'ordre des onglets dans la sidebar.
		expect(got?.fileIds).toEqual(ids);
	});

	it('coexiste avec drafts et trashed (pas de collision entre tables)', async () => {
		// Ce test cadenasse le bump v3 : la table workspaces ne doit pas casser
		// les autres tables. On ajoute une row dans chaque et on vérifie.
		await db.drafts.put({
			id: 'd1',
			name: 'doc.md',
			content: 'x',
			createdAt: 1,
			updatedAt: 1,
			order: 0
		});
		const wsRow = makeRow({ name: 'Atelier' });
		await db.workspaces.put(wsRow);

		expect(await db.drafts.count()).toBe(1);
		expect(await db.workspaces.count()).toBe(1);
		expect(await db.trashed.count()).toBe(0);

		// Nettoyage drafts pour ne pas polluer les autres tests files.
		await db.drafts.clear();
	});
});
