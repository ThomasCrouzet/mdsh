import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db, type WorkspaceRow } from './db';
import { workspaceStore } from './workspaces.svelte';
import { filesStore } from './files.svelte';

// Tests du store workspaces (singleton runes) sous fake-indexeddb. Le store
// orchestre l'ouverture/fermeture via filesStore ; les fichiers restent en base.

function wsRow(id: string, name: string, fileIds: string[] = [], updatedAt = 1000): WorkspaceRow {
	return { id, name, fileIds, activeId: fileIds[0] ?? null, createdAt: 1000, updatedAt };
}

beforeEach(async () => {
	await Promise.all([db.drafts.clear(), db.trashed.clear(), db.workspaces.clear()]);
	localStorage.clear();
	await filesStore.reload(false);
	workspaceStore.workspaces = [];
	workspaceStore.loaded = false;
});

describe('workspaceStore.save', () => {
	it("enregistre l'état courant (fichiers ouverts + activeId)", async () => {
		const a = filesStore.createNew('a.md', '');
		const b = filesStore.createNew('b.md', '');
		filesStore.setActive(b.id);
		const ws = await workspaceStore.save('Projet');
		expect(ws).not.toBeNull();
		expect(ws!.name).toBe('Projet');
		expect(ws!.fileIds).toEqual([a.id, b.id]);
		expect(ws!.activeId).toBe(b.id);
		expect(workspaceStore.workspaces[0]?.id).toBe(ws!.id);
		expect(await db.workspaces.get(ws!.id)).toBeTruthy();
	});

	it('nom vide -> nom de repli non vide', async () => {
		const ws = await workspaceStore.save('   ');
		expect(ws!.name.trim().length).toBeGreaterThan(0);
	});
});

describe('workspaceStore.load / reload', () => {
	it('charge les workspaces, plus récents en tête', async () => {
		await db.workspaces.bulkPut([wsRow('w1', 'Un', [], 1), wsRow('w2', 'Deux', [], 2)]);
		await workspaceStore.load();
		expect(workspaceStore.workspaces.map((w) => w.id)).toEqual(['w2', 'w1']);
	});

	it('reload force une relecture', async () => {
		await workspaceStore.load();
		await db.workspaces.put(wsRow('w3', 'Trois', [], 3));
		await workspaceStore.reload();
		expect(workspaceStore.workspaces.some((w) => w.id === 'w3')).toBe(true);
	});
});

describe('workspaceStore.update / rename / delete', () => {
	it("update reflète l'état courant", async () => {
		filesStore.createNew('a.md', '');
		const ws = await workspaceStore.save('WS');
		const b = filesStore.createNew('b.md', '');
		await workspaceStore.update(ws!.id);
		const updated = workspaceStore.workspaces.find((w) => w.id === ws!.id);
		expect(updated!.fileIds).toContain(b.id);
	});

	it('rename change le nom; vide = no-op', async () => {
		const ws = await workspaceStore.save('Old');
		await workspaceStore.rename(ws!.id, 'New');
		expect(workspaceStore.workspaces.find((w) => w.id === ws!.id)!.name).toBe('New');
		await workspaceStore.rename(ws!.id, '   ');
		expect(workspaceStore.workspaces.find((w) => w.id === ws!.id)!.name).toBe('New');
	});

	it('delete retire de la liste et de la base', async () => {
		const ws = await workspaceStore.save('Del');
		await workspaceStore.delete(ws!.id);
		expect(workspaceStore.workspaces.some((w) => w.id === ws!.id)).toBe(false);
		expect(await db.workspaces.get(ws!.id)).toBeUndefined();
	});

	it('ignore les identifiants inconnus et un second chargement déjà terminé', async () => {
		await workspaceStore.load();
		await workspaceStore.load();
		await workspaceStore.update('ghost');
		await workspaceStore.rename('ghost', 'Inconnu');
		await workspaceStore.delete('ghost');

		expect(workspaceStore.workspaces).toEqual([]);
	});
});

describe('workspaceStore.restore', () => {
	it('rouvre les fichiers du workspace fermés (keepDB) et active la cible', async () => {
		const a = filesStore.createNew('a.md', '# A');
		const b = filesStore.createNew('b.md', '# B');
		filesStore.setActive(b.id);
		await filesStore.flushPending();
		const ws = await workspaceStore.save('Both');

		// Ferme B sans le supprimer de la base (keepDB) : il quitte la vue.
		filesStore.close(b.id, { trash: false, keepDB: true });
		expect(filesStore.files.some((f) => f.id === b.id)).toBe(false);

		await workspaceStore.restore(ws!.id);
		// B est rouvert, la cible activeId restaurée.
		expect(filesStore.files.some((f) => f.id === b.id)).toBe(true);
		expect(filesStore.files.some((f) => f.id === a.id)).toBe(true);
		expect(filesStore.activeId).toBe(b.id);
	});

	it("restore d'un id inconnu = no-op", async () => {
		await expect(workspaceStore.restore('ghost')).resolves.toBeUndefined();
	});

	it('ignore les fichiers supprimés et un activeId qui n’existe plus', async () => {
		workspaceStore.workspaces = [
			{
				...wsRow('missing', 'Missing', ['deleted']),
				activeId: 'deleted'
			}
		];

		await workspaceStore.restore('missing');

		expect(filesStore.files).toEqual([]);
		expect(filesStore.activeId).toBeNull();
	});

	it('ferme les onglets hors workspace sans les supprimer de la base (keepDB)', async () => {
		// Workspace = {a}. Session courante = {a, b}. restore doit fermer b de la
		// vue mais le laisser en base (branche keepDB du closeMany de l etape 2).
		const a = filesStore.createNew('a.md', '# A');
		filesStore.setActive(a.id);
		await filesStore.flushPending();
		const ws = await workspaceStore.save('SeulementA');

		const b = filesStore.createNew('b.md', '# B');
		await filesStore.flushPending();
		expect(filesStore.files.some((f) => f.id === b.id)).toBe(true);

		await workspaceStore.restore(ws!.id);

		// b a quitte la vue...
		expect(filesStore.files.some((f) => f.id === b.id)).toBe(false);
		// ...mais reste dans la base (keepDB: true).
		expect(await db.drafts.get(b.id)).toBeTruthy();
		expect(filesStore.activeId).toBe(a.id);
	});
});

describe('workspaceStore - chemins d echec IDB', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('update : rollback complet des champs et de la position si le put echoue', async () => {
		// Deux workspaces : on edite le PLUS ANCIEN (en queue) pour observer le
		// rollback de position (il remonte en tete, puis doit redescendre).
		filesStore.createNew('seed.md', '');
		const wsOld = await workspaceStore.save('Old');
		const wsNew = await workspaceStore.save('New');
		// Apres save, le plus recent (wsNew) est en tete.
		expect(workspaceStore.workspaces[0]?.id).toBe(wsNew!.id);

		const target = workspaceStore.workspaces.find((w) => w.id === wsOld!.id)!;
		const prevFileIds = target.fileIds;
		const prevActiveId = target.activeId;
		const prevUpdatedAt = target.updatedAt;
		const prevIdx = workspaceStore.workspaces.indexOf(target);
		expect(prevIdx).toBe(1); // en queue

		// Modifie l etat courant puis fait echouer la persistance.
		filesStore.createNew('extra.md', '');
		const putSpy = vi
			.spyOn(db.workspaces, 'put')
			.mockRejectedValueOnce(new Error('IDB write failed'));

		await workspaceStore.update(wsOld!.id);
		expect(putSpy).toHaveBeenCalled();

		// Rollback : champs restaures a l identique.
		const after = workspaceStore.workspaces.find((w) => w.id === wsOld!.id)!;
		expect(after.fileIds).toEqual(prevFileIds);
		expect(after.activeId).toBe(prevActiveId);
		expect(after.updatedAt).toBe(prevUpdatedAt);
		// Rollback : position restauree (revient en queue, pas en tete).
		expect(workspaceStore.workspaces.indexOf(after)).toBe(prevIdx);
	});

	it('save : ne crée pas de workspace fantôme si le put échoue', async () => {
		vi.spyOn(db.workspaces, 'put').mockRejectedValueOnce(new Error('IDB write failed'));

		await expect(workspaceStore.save('Impossible')).resolves.toBeNull();

		expect(workspaceStore.workspaces).toEqual([]);
	});

	it('rename : restaure le nom et la date si le put échoue', async () => {
		const ws = await workspaceStore.save('Stable');
		const previousUpdatedAt = ws!.updatedAt;
		vi.spyOn(db.workspaces, 'put').mockRejectedValueOnce(new Error('IDB write failed'));

		await workspaceStore.rename(ws!.id, 'Fantôme');

		expect(ws!.name).toBe('Stable');
		expect(ws!.updatedAt).toBe(previousUpdatedAt);
	});

	it('delete : conserve le workspace visible si la suppression échoue', async () => {
		const ws = await workspaceStore.save('Conserver');
		vi.spyOn(db.workspaces, 'delete').mockRejectedValueOnce(new Error('IDB delete failed'));

		await workspaceStore.delete(ws!.id);

		expect(workspaceStore.workspaces.some((candidate) => candidate.id === ws!.id)).toBe(true);
	});

	it('delete : tolère la disparition concurrente de la ligne en mémoire', async () => {
		const ws = await workspaceStore.save('Concurrent');
		vi.spyOn(db.workspaces, 'delete').mockImplementationOnce(() => {
			workspaceStore.workspaces = [];
			return db.workspaces.clear();
		});

		await workspaceStore.delete(ws!.id);

		expect(workspaceStore.workspaces).toEqual([]);
	});

	it('restore : bulkGet qui rejette est notifie et abandonne proprement', async () => {
		// Workspace reference un fichier present en base mais ferme de la vue.
		const a = filesStore.createNew('a.md', '# A');
		await filesStore.flushPending();
		const ws = await workspaceStore.save('AvecA');
		filesStore.close(a.id, { trash: false, keepDB: true });
		expect(filesStore.files.some((f) => f.id === a.id)).toBe(false);

		const bulkGetSpy = vi
			.spyOn(db.drafts, 'bulkGet')
			.mockRejectedValueOnce(new Error('IDB read failed'));

		// Ne doit pas rejeter (catch interne + reportPersistenceError + return).
		await expect(workspaceStore.restore(ws!.id)).resolves.toBeUndefined();
		expect(bulkGetSpy).toHaveBeenCalled();
		// L echec de lecture interrompt restore : a n est PAS rouvert.
		expect(filesStore.files.some((f) => f.id === a.id)).toBe(false);
	});

	it('restore keeps every tab and in-memory revision when flush fails', async () => {
		const a = filesStore.createNew('a.md', '# version mémoire');
		await filesStore.flushPendingAwait();
		const ws = await workspaceStore.save('Stable');
		const b = filesStore.createNew('b.md', '# ne pas fermer');
		filesStore.updateContent(a.id, '# dernière révision');
		vi.spyOn(db.drafts, 'put').mockRejectedValue(new Error('IDB unavailable'));

		await workspaceStore.restore(ws!.id);

		expect(filesStore.files.map((file) => file.id)).toEqual([a.id, b.id]);
		expect(filesStore.files.find((file) => file.id === a.id)?.content).toBe('# dernière révision');
		expect(filesStore.files.find((file) => file.id === b.id)?.content).toBe('# ne pas fermer');
	});
});
