import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from './db';
import {
	VERSION_LIMITS,
	deleteVersionsFor,
	listVersions,
	pruneVersions,
	recordVersion,
	createCheckpoint,
	createCheckpoints
} from './version-history';

beforeEach(async () => {
	await db.versions.clear();
});
afterEach(async () => {
	await db.versions.clear();
});

const T0 = 1_000_000_000_000;

describe('explicit checkpoints', () => {
	it('archives an immediate state during throttling and accepts an empty document', async () => {
		await recordVersion({ id: 'd', name: 'd.md', content: 'initial' }, T0);
		await createCheckpoint({ id: 'd', name: 'd.md', content: 'avant remplacement' }, T0 + 1);
		await createCheckpoint({ id: 'd', name: 'd.md', content: '' }, T0 + 2);
		expect((await listVersions('d')).map((version) => version.content)).toEqual([
			'',
			'avant remplacement',
			'initial'
		]);
	});

	it('cancels all batch checkpoints after a write failure', async () => {
		const realPut = db.versions.put.bind(db.versions);
		const spy = vi.spyOn(db.versions, 'put').mockImplementation((row) => {
			if (row.draftId === 'b') throw new Error('quota');
			return realPut(row);
		});
		try {
			await expect(
				createCheckpoints(
					[
						{ id: 'a', name: 'a.md', content: 'a' },
						{ id: 'b', name: 'b.md', content: 'b' }
					],
					T0
				)
			).rejects.toThrow('quota');
			expect(await db.versions.count()).toBe(0);
		} finally {
			spy.mockRestore();
		}
	});
});

describe('recordVersion', () => {
	it('does not duplicate content from the last snapshot', async () => {
		await recordVersion({ id: 'd1', name: 'a.md', content: 'same' }, T0);
		const ok = await recordVersion(
			{ id: 'd1', name: 'a.md', content: 'same' },
			T0 + VERSION_LIMITS.minIntervalMs + 1
		);
		expect(ok).toBe(false);
		expect(await db.versions.where('draftId').equals('d1').count()).toBe(1);
	});

	it('rejects a snapshot during the throttle interval', async () => {
		await recordVersion({ id: 'd1', name: 'a.md', content: 'v1' }, T0);
		const ok = await recordVersion({ id: 'd1', name: 'a.md', content: 'v2' }, T0 + 1000);
		expect(ok).toBe(false);
		expect(await db.versions.count()).toBe(1);
	});

	it('accepts a snapshot after the minimum interval', async () => {
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
	it('deletes versions older than maxAge', async () => {
		const now = T0 + VERSION_LIMITS.maxAgeMs + 2000;
		await db.versions.bulkPut([
			// At T0, 'old' is maxAge + 2000 old, so it is expired.
			{ id: 'old', draftId: 'd1', name: 'a', content: 'x', createdAt: T0 },
			// At now - 1000, 'recent' is 1000 ms old, so keep it.
			{ id: 'recent', draftId: 'd1', name: 'a', content: 'y', createdAt: now - 1000 }
		]);
		const deleted = await pruneVersions('d1', now);
		expect(deleted).toBe(1);
		const ids = (await db.versions.where('draftId').equals('d1').toArray()).map((v) => v.id);
		expect(ids).toEqual(['recent']);
	});

	it('keeps only the latest maxPerDraft versions', async () => {
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
		// The oldest version, v0, must be removed. The newest version must remain.
		expect(await db.versions.get('v0')).toBeUndefined();
		expect(await db.versions.get(`v${rows.length - 1}`)).toBeTruthy();
	});
});

describe('listVersions', () => {
	it('isolates versions by draftId', async () => {
		await db.versions.bulkPut([
			{ id: 'a', draftId: 'd1', name: 'n', content: '1', createdAt: T0 },
			{ id: 'b', draftId: 'd2', name: 'n', content: '2', createdAt: T0 }
		]);
		expect((await listVersions('d1')).map((v) => v.id)).toEqual(['a']);
	});
});

describe('deleteVersionsFor', () => {
	it('deletes all history for a file', async () => {
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
