import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from './db';
import {
	VERSION_LIMITS,
	deleteVersionsFor,
	lineDiffStats,
	listVersions,
	pruneVersions,
	recordVersion
} from './version-history';

beforeEach(async () => {
	await db.versions.clear();
});
afterEach(async () => {
	await db.versions.clear();
});

const T0 = 1_000_000_000_000;

describe('recordVersion', () => {
	it('écrit un premier snapshot', async () => {
		const ok = await recordVersion({ id: 'd1', name: 'a.md', content: 'v1' }, T0);
		expect(ok).toBe(true);
		expect(await db.versions.where('draftId').equals('d1').count()).toBe(1);
	});

	it('ignore un contenu vide', async () => {
		expect(await recordVersion({ id: 'd1', name: 'a.md', content: '   ' }, T0)).toBe(false);
		expect(await db.versions.count()).toBe(0);
	});

	it('ne duplique pas un contenu identique au dernier snapshot', async () => {
		await recordVersion({ id: 'd1', name: 'a.md', content: 'same' }, T0);
		const ok = await recordVersion(
			{ id: 'd1', name: 'a.md', content: 'same' },
			T0 + VERSION_LIMITS.minIntervalMs + 1
		);
		expect(ok).toBe(false);
		expect(await db.versions.where('draftId').equals('d1').count()).toBe(1);
	});

	it('throttle : refuse un snapshot trop rapproché même si le contenu change', async () => {
		await recordVersion({ id: 'd1', name: 'a.md', content: 'v1' }, T0);
		const ok = await recordVersion({ id: 'd1', name: 'a.md', content: 'v2' }, T0 + 1000);
		expect(ok).toBe(false);
		expect(await db.versions.count()).toBe(1);
	});

	it('accepte un nouveau snapshot après l’intervalle minimal', async () => {
		await recordVersion({ id: 'd1', name: 'a.md', content: 'v1' }, T0);
		const ok = await recordVersion(
			{ id: 'd1', name: 'a.md', content: 'v2' },
			T0 + VERSION_LIMITS.minIntervalMs + 1
		);
		expect(ok).toBe(true);
		expect(await db.versions.where('draftId').equals('d1').count()).toBe(2);
	});
});

describe('pruneVersions', () => {
	it('supprime les versions plus vieilles que maxAge', async () => {
		const now = T0 + VERSION_LIMITS.maxAgeMs + 2000;
		await db.versions.bulkPut([
			// 'old' à T0 → âge = maxAge + 2000 > maxAge → expirée.
			{ id: 'old', draftId: 'd1', name: 'a', content: 'x', createdAt: T0 },
			// 'recent' à now - 1000 → âge 1000 ms → conservée.
			{ id: 'recent', draftId: 'd1', name: 'a', content: 'y', createdAt: now - 1000 }
		]);
		const deleted = await pruneVersions('d1', now);
		expect(deleted).toBe(1);
		const ids = (await db.versions.where('draftId').equals('d1').toArray()).map((v) => v.id);
		expect(ids).toEqual(['recent']);
	});

	it('garde uniquement les maxPerDraft plus récentes', async () => {
		const rows = Array.from({ length: VERSION_LIMITS.maxPerDraft + 5 }, (_, i) => ({
			id: `v${i}`,
			draftId: 'd1',
			name: 'a',
			content: `c${i}`,
			createdAt: T0 + i * 1000
		}));
		await db.versions.bulkPut(rows);
		await pruneVersions('d1', T0 + rows.length * 1000);
		expect(await db.versions.where('draftId').equals('d1').count()).toBe(
			VERSION_LIMITS.maxPerDraft
		);
		// La plus ancienne (v0) doit avoir disparu, la plus récente rester.
		expect(await db.versions.get('v0')).toBeUndefined();
		expect(await db.versions.get(`v${rows.length - 1}`)).toBeTruthy();
	});
});

describe('listVersions', () => {
	it('renvoie les versions, plus récentes d’abord', async () => {
		await db.versions.bulkPut([
			{ id: 'a', draftId: 'd1', name: 'n', content: '1', createdAt: T0 },
			{ id: 'b', draftId: 'd1', name: 'n', content: '2', createdAt: T0 + 5000 },
			{ id: 'c', draftId: 'd1', name: 'n', content: '3', createdAt: T0 + 2000 }
		]);
		const list = await listVersions('d1');
		expect(list.map((v) => v.id)).toEqual(['b', 'c', 'a']);
	});

	it('isole par draftId', async () => {
		await db.versions.bulkPut([
			{ id: 'a', draftId: 'd1', name: 'n', content: '1', createdAt: T0 },
			{ id: 'b', draftId: 'd2', name: 'n', content: '2', createdAt: T0 }
		]);
		expect((await listVersions('d1')).map((v) => v.id)).toEqual(['a']);
	});
});

describe('lineDiffStats', () => {
	it('contenu identique → 0/0', () => {
		expect(lineDiffStats('a\nb\nc', 'a\nb\nc')).toEqual({ added: 0, removed: 0 });
	});
	it('lignes ajoutées', () => {
		expect(lineDiffStats('a\nb', 'a\nb\nc\nd')).toEqual({ added: 2, removed: 0 });
	});
	it('lignes retirées', () => {
		expect(lineDiffStats('a\nb\nc', 'a')).toEqual({ added: 0, removed: 2 });
	});
	it('lignes modifiées comptent comme +1/-1', () => {
		expect(lineDiffStats('a\nb\nc', 'a\nX\nc')).toEqual({ added: 1, removed: 1 });
	});
});

describe('deleteVersionsFor', () => {
	it('purge tout l’historique d’un fichier', async () => {
		await db.versions.bulkPut([
			{ id: 'a', draftId: 'd1', name: 'n', content: '1', createdAt: T0 },
			{ id: 'b', draftId: 'd1', name: 'n', content: '2', createdAt: T0 + 1 },
			{ id: 'c', draftId: 'd2', name: 'n', content: '3', createdAt: T0 }
		]);
		await deleteVersionsFor('d1');
		expect(await db.versions.where('draftId').equals('d1').count()).toBe(0);
		expect(await db.versions.where('draftId').equals('d2').count()).toBe(1);
	});
});
