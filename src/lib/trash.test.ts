import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from './db';
import type { DraftRow, TrashedRow } from './db';
import { TIMERS } from './config';
import {
	loadTrashRows,
	moveToTrash,
	restoreFromTrash,
	purgePermanently,
	persistReorder
} from './trash';
import { recordVersion } from './version-history';

// Horodatage de référence fixe (ms epoch) pour rendre les calculs de fenêtre
// d'undo déterministes - jamais de `Date.now()` dans les assertions.
const T0 = 1_000_000_000_000;

/** Fabrique une row `drafts` minimale. */
function draftRow(id: string, order = 0): DraftRow {
	return {
		id,
		name: `${id}.md`,
		content: `contenu ${id}`,
		createdAt: T0,
		updatedAt: T0,
		order
	};
}

/** Fabrique une row `trashed` minimale. */
function trashedRow(id: string, trashedAt: number, order = 0): TrashedRow {
	return { id, file: draftRow(id, order), order, trashedAt };
}

beforeEach(async () => {
	await db.drafts.clear();
	await db.trashed.clear();
	await db.versions.clear();
});
afterEach(async () => {
	await db.drafts.clear();
	await db.trashed.clear();
	await db.versions.clear();
});

describe('loadTrashRows', () => {
	it('corbeille vide → tableau vide', async () => {
		expect(await loadTrashRows(T0)).toEqual([]);
	});

	it('conserve une entrée encore dans la fenêtre d’undo avec le remainingMs exact', async () => {
		// Mise en corbeille il y a 2000 ms → il reste 5000 - 2000 = 3000 ms.
		await db.trashed.put(trashedRow('keep', T0 - 2000, 1));
		const now = T0;

		const results = await loadTrashRows(now);

		expect(results).toHaveLength(1);
		expect(results[0]!.remainingMs).toBe(TIMERS.trashUndoMs - 2000); // 3000
		expect(results[0]!.entry.order).toBe(1);
		expect(results[0]!.entry.trashedAt).toBe(T0 - 2000);
		// L'entrée DB n'est pas purgée - toujours présente.
		expect(await db.trashed.get('keep')).toBeTruthy();
	});

	it('reconstruit le FileItem (dirty/linkedToDisk réinitialisés) depuis la row stockée', async () => {
		await db.trashed.put(trashedRow('f1', T0 - 1000, 3));

		const { entry } = (await loadTrashRows(T0))[0]!;

		expect(entry.file).toEqual({
			id: 'f1',
			name: 'f1.md',
			content: 'contenu f1',
			createdAt: T0,
			updatedAt: T0,
			dirty: false,
			linkedToDisk: false
		});
	});

	it('purge en base une entrée expirée (fenêtre d’undo dépassée) et l’exclut du résultat', async () => {
		// Mise en corbeille il y a exactement trashUndoMs → remainingMs = 0 → purge.
		await db.trashed.put(trashedRow('expired', T0 - TIMERS.trashUndoMs, 0));

		const results = await loadTrashRows(T0);

		expect(results).toEqual([]);
		expect(await db.trashed.get('expired')).toBeUndefined();
	});

	it('purge une entrée largement expirée mais garde une entrée récente (tri par trashedAt)', async () => {
		await db.trashed.bulkPut([
			trashedRow('old', T0 - TIMERS.trashUndoMs - 10_000, 0),
			trashedRow('fresh', T0 - 1000, 1)
		]);

		const results = await loadTrashRows(T0);

		expect(results.map((r) => r.entry.file.id)).toEqual(['fresh']);
		expect(results[0]!.remainingMs).toBe(TIMERS.trashUndoMs - 1000); // 4000
		expect(await db.trashed.get('old')).toBeUndefined();
		expect(await db.trashed.get('fresh')).toBeTruthy();
	});

	it('renvoie les entrées dans l’ordre de trashedAt croissant', async () => {
		await db.trashed.bulkPut([
			trashedRow('b', T0 - 1000, 0),
			trashedRow('a', T0 - 3000, 1),
			trashedRow('c', T0 - 2000, 2)
		]);

		const results = await loadTrashRows(T0);

		// orderBy('trashedAt') → 'a' (-3000) puis 'c' (-2000) puis 'b' (-1000).
		expect(results.map((r) => r.entry.file.id)).toEqual(['a', 'c', 'b']);
	});
});

describe('moveToTrash', () => {
	it('retire le fichier de drafts et l’ajoute à trashed (transactionnel)', async () => {
		await db.drafts.put(draftRow('d1', 2));
		const row = await db.drafts.get('d1');
		expect(row).toBeTruthy();

		const ok = await moveToTrash('d1', row!, 2, T0);

		expect(ok).toBe(true);
		expect(await db.drafts.get('d1')).toBeUndefined();
		const trashed = await db.trashed.get('d1');
		expect(trashed).toEqual({ id: 'd1', file: row, order: 2, trashedAt: T0 });
	});

	it('n’affecte pas les autres drafts', async () => {
		await db.drafts.bulkPut([draftRow('d1', 0), draftRow('d2', 1)]);

		await moveToTrash('d1', draftRow('d1', 0), 0, T0);

		expect(await db.drafts.get('d2')).toBeTruthy();
		expect(await db.drafts.count()).toBe(1);
		expect(await db.trashed.count()).toBe(1);
	});

	it('round-trip : un fichier déplacé est rechargé par loadTrashRows', async () => {
		await db.drafts.put(draftRow('rt', 0));
		await moveToTrash('rt', draftRow('rt', 0), 0, T0 - 500);

		const results = await loadTrashRows(T0);

		expect(results).toHaveLength(1);
		expect(results[0]!.entry.file.id).toBe('rt');
		expect(results[0]!.remainingMs).toBe(TIMERS.trashUndoMs - 500); // 4500
	});
});

describe('restoreFromTrash', () => {
	it('réécrit la row drafts ET supprime trashed dans une transaction atomique', async () => {
		await db.trashed.put(trashedRow('r1', T0, 0));
		const row = draftRow('r1', 0);

		const ok = await restoreFromTrash('r1', row);

		expect(ok).toBe(true);
		expect(await db.trashed.get('r1')).toBeUndefined();
		expect(await db.drafts.get('r1')).toEqual(row);
	});

	it('aucune fenêtre où le fichier n’est dans aucune table (drafts présent après restore)', async () => {
		await db.trashed.put(trashedRow('r2', T0, 1));
		await restoreFromTrash('r2', draftRow('r2', 1));
		// L'entrée a quitté trashed ET est présente dans drafts (pas de trou).
		expect(await db.drafts.count()).toBe(1);
		expect(await db.trashed.count()).toBe(0);
	});
});

describe('purgePermanently', () => {
	it('supprime définitivement l’entrée de trashed', async () => {
		await db.trashed.bulkPut([trashedRow('p1', T0, 0), trashedRow('p2', T0, 1)]);

		await purgePermanently('p1');

		expect(await db.trashed.get('p1')).toBeUndefined();
		expect(await db.trashed.get('p2')).toBeTruthy();
		expect(await db.trashed.count()).toBe(1);
	});

	it('purge aussi l’historique de versions du fichier (pas de snapshots orphelins)', async () => {
		await db.trashed.put(trashedRow('p3', T0, 0));
		await recordVersion({ id: 'p3', name: 'p3.md', content: 'du contenu' }, T0);
		expect(await db.versions.where('draftId').equals('p3').count()).toBe(1);

		await purgePermanently('p3');

		expect(await db.trashed.get('p3')).toBeUndefined();
		expect(await db.versions.where('draftId').equals('p3').count()).toBe(0);
	});

	it('id inexistant → no-op silencieux (pas d’erreur)', async () => {
		await expect(purgePermanently('ghost')).resolves.toBeUndefined();
		expect(await db.trashed.count()).toBe(0);
	});
});

describe('persistReorder', () => {
	it('réécrit le champ order de chaque draft selon l’index du tableau', async () => {
		await db.drafts.bulkPut([draftRow('a', 0), draftRow('b', 1), draftRow('c', 2)]);

		// Nouvel ordre : c, a, b → orders 0, 1, 2.
		await persistReorder(['c', 'a', 'b']);

		expect((await db.drafts.get('c'))!.order).toBe(0);
		expect((await db.drafts.get('a'))!.order).toBe(1);
		expect((await db.drafts.get('b'))!.order).toBe(2);
	});

	it('ne touche que le champ order (contenu/nom préservés)', async () => {
		await db.drafts.put(draftRow('a', 5));

		await persistReorder(['a']);

		const row = await db.drafts.get('a');
		expect(row).toEqual({
			id: 'a',
			name: 'a.md',
			content: 'contenu a',
			createdAt: T0,
			updatedAt: T0,
			order: 0
		});
	});

	it('renvoie un timestamp ≥ à l’instant d’appel (pour lastSavedAt)', async () => {
		await db.drafts.put(draftRow('a', 0));
		const before = Date.now();

		const ts = await persistReorder(['a']);

		expect(ts).toBeGreaterThanOrEqual(before);
		expect(ts).toBeLessThanOrEqual(Date.now());
	});

	it('un id inexistant dans la liste est ignoré sans erreur', async () => {
		await db.drafts.put(draftRow('a', 0));

		// 'ghost' n'existe pas : Dexie update() renvoie 0 ligne modifiée, pas d'erreur.
		await expect(persistReorder(['ghost', 'a'])).resolves.toBeGreaterThan(0);
		expect((await db.drafts.get('a'))!.order).toBe(1);
		expect(await db.drafts.get('ghost')).toBeUndefined();
	});
});
