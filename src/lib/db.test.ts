import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Dexie from 'dexie';
import { db, newId, type VersionRow, type TemplateRow } from './db';

// §2.4 / §2.7 - Lock the Dexie v4 schema. These tests fail if an upgrade does not
// keep the required tables and indexes.

beforeEach(async () => {
	await Promise.all([db.versions.clear(), db.templates.clear()]);
});
afterEach(async () => {
	await Promise.all([db.versions.clear(), db.templates.clear()]);
});

function makeVersion(p: Partial<VersionRow> = {}): VersionRow {
	return {
		id: p.id ?? newId(),
		draftId: p.draftId ?? 'draft-1',
		name: p.name ?? 'doc.md',
		content: p.content ?? 'contenu',
		createdAt: p.createdAt ?? Date.now()
	};
}

function makeTemplate(p: Partial<TemplateRow> = {}): TemplateRow {
	const now = Date.now();
	return {
		id: p.id ?? newId(),
		name: p.name ?? 'Modèle',
		content: p.content ?? '# Titre',
		builtin: p.builtin ?? false,
		createdAt: p.createdAt ?? now,
		updatedAt: p.updatedAt ?? now
	};
}

describe('db.versions - schema v4', () => {
	it('starts empty', async () => {
		expect(await db.versions.toArray()).toEqual([]);
	});

	it('persists multiple versions for one draft', async () => {
		await db.versions.bulkPut([
			makeVersion({ draftId: 'd1', createdAt: 1000 }),
			makeVersion({ draftId: 'd1', createdAt: 2000 }),
			makeVersion({ draftId: 'd2', createdAt: 1500 })
		]);
		const d1 = await db.versions.where('draftId').equals('d1').toArray();
		expect(d1).toHaveLength(2);
	});

	it('lists draft history by createdAt through the compound index', async () => {
		await db.versions.bulkPut([
			makeVersion({ draftId: 'd1', content: 'v2', createdAt: 2000 }),
			makeVersion({ draftId: 'd1', content: 'v1', createdAt: 1000 }),
			makeVersion({ draftId: 'd1', content: 'v3', createdAt: 3000 })
		]);
		const ordered = await db.versions
			.where('[draftId+createdAt]')
			.between(['d1', Dexie.minKey], ['d1', Dexie.maxKey])
			.toArray();
		expect(ordered.map((v) => v.content)).toEqual(['v1', 'v2', 'v3']);
	});

	it('deletes the oldest versions', async () => {
		await db.versions.bulkPut([
			makeVersion({ id: 'a', draftId: 'd1', createdAt: 1000 }),
			makeVersion({ id: 'b', draftId: 'd1', createdAt: 2000 }),
			makeVersion({ id: 'c', draftId: 'd1', createdAt: 3000 })
		]);
		// Keep the two latest versions and delete the oldest version with ID `a`.
		const all = await db.versions.where('draftId').equals('d1').sortBy('createdAt');
		const toDelete = all.slice(0, all.length - 2).map((v) => v.id);
		await db.versions.bulkDelete(toDelete);
		const remaining = await db.versions.where('draftId').equals('d1').toArray();
		expect(remaining.map((v) => v.id).sort()).toEqual(['b', 'c']);
	});
});

describe('db.templates - schema v4', () => {
	it('starts empty', async () => {
		expect(await db.templates.toArray()).toEqual([]);
	});

	it('distingue builtin et custom', async () => {
		await db.templates.bulkPut([
			makeTemplate({ id: 'builtin:journal', builtin: true }),
			makeTemplate({ builtin: false })
		]);
		const builtins = (await db.templates.toArray()).filter((t) => t.builtin);
		expect(builtins).toHaveLength(1);
		expect(builtins[0]?.id).toBe('builtin:journal');
	});

	it('keeps put() idempotent for a stable built-in ID', async () => {
		const t = makeTemplate({ id: 'builtin:todo', builtin: true });
		await db.templates.put(t);
		await db.templates.put({ ...t, updatedAt: t.updatedAt + 1 });
		expect(await db.templates.count()).toBe(1);
	});

	it('lists records by updatedAt', async () => {
		await db.templates.bulkPut([
			makeTemplate({ name: 'A', updatedAt: 1000 }),
			makeTemplate({ name: 'B', updatedAt: 3000 }),
			makeTemplate({ name: 'C', updatedAt: 2000 })
		]);
		const ordered = await db.templates.orderBy('updatedAt').reverse().toArray();
		expect(ordered.map((t) => t.name)).toEqual(['B', 'C', 'A']);
	});
});

describe('additive Dexie schema migration without data loss', () => {
	const DB_NAME = 'mdsh-migration-spec';

	afterEach(async () => {
		await Dexie.delete(DB_NAME);
	});

	it('keeps a v1 draft during the v1 to v4 upgrade and creates new tables', async () => {
		// 1. Create the v1 database with only drafts and one row.
		const v1 = new Dexie(DB_NAME);
		v1.version(1).stores({ drafts: 'id, updatedAt, order' });
		await v1.open();
		await v1.table('drafts').put({
			id: 'd1',
			name: 'old.md',
			content: 'écrit en v1',
			createdAt: 1,
			updatedAt: 1,
			order: 0
		});
		v1.close();

		// 2. Open the complete MdshDB schema chain to start the upgrade.
		const full = new Dexie(DB_NAME);
		full.version(1).stores({ drafts: 'id, updatedAt, order' });
		full.version(2).stores({ drafts: 'id, updatedAt, order', trashed: 'id, trashedAt' });
		full.version(3).stores({
			drafts: 'id, updatedAt, order',
			trashed: 'id, trashedAt',
			workspaces: 'id, updatedAt'
		});
		full.version(4).stores({
			drafts: 'id, updatedAt, order',
			trashed: 'id, trashedAt',
			workspaces: 'id, updatedAt',
			versions: 'id, draftId, createdAt, [draftId+createdAt]',
			templates: 'id, updatedAt'
		});
		await full.open();

		// The migration keeps the v1 data.
		const draft = await full.table('drafts').get('d1');
		expect(draft?.content).toBe('écrit en v1');
		// The new tables are operational.
		expect(await full.table('versions').toArray()).toEqual([]);
		expect(await full.table('templates').toArray()).toEqual([]);
		// Index composite v4 fonctionnel.
		await full
			.table('versions')
			.put({ id: 'v', draftId: 'd1', name: 'x', content: 'c', createdAt: 1 });
		const byComposite = await full
			.table('versions')
			.where('[draftId+createdAt]')
			.between(['d1', Dexie.minKey], ['d1', Dexie.maxKey])
			.toArray();
		expect(byComposite).toHaveLength(1);
		full.close();
	});
});
