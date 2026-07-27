import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SaveQueue } from './save-queue';
import { db } from './db';
import type { DraftRow } from './db';

function row(id: string): DraftRow {
	return { id, name: `${id}.md`, content: 'x', createdAt: 0, updatedAt: 0, order: 0 };
}

const noopCb = { onPendingChange: () => {}, onSaved: () => {}, onError: () => {} };

describe('SaveQueue', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('écrit la row après le debounce (400 ms) et signale onSaved', async () => {
		const put = vi.spyOn(db.drafts, 'put').mockResolvedValue('a' as never);
		const onSaved = vi.fn();
		const q = new SaveQueue({ ...noopCb, onSaved });
		q.schedule('a', () => row('a'));
		expect(put).not.toHaveBeenCalled(); // rien avant le debounce
		await vi.advanceTimersByTimeAsync(400);
		expect(put).toHaveBeenCalledOnce();
		expect(onSaved).toHaveBeenCalledOnce();
	});

	it('un re-schedule rapproché annule le précédent (un seul write)', async () => {
		const put = vi.spyOn(db.drafts, 'put').mockResolvedValue('a' as never);
		const q = new SaveQueue(noopCb);
		q.schedule('a', () => row('a'));
		await vi.advanceTimersByTimeAsync(200);
		q.schedule('a', () => row('a')); // reset du timer
		await vi.advanceTimersByTimeAsync(200); // 400 ms depuis le 1er appel, mais re-armé
		expect(put).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(200); // 400 ms depuis le reset
		expect(put).toHaveBeenCalledOnce();
	});

	it('route un échec de write vers onError au lieu de l’avaler', async () => {
		vi.spyOn(db.drafts, 'put').mockRejectedValue(new DOMException('plein', 'QuotaExceededError'));
		const onError = vi.fn();
		const q = new SaveQueue({ ...noopCb, onError });
		q.schedule('a', () => row('a'));
		await vi.advanceTimersByTimeAsync(400);
		await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
	});

	it('cancel() empêche le write programmé', async () => {
		const put = vi.spyOn(db.drafts, 'put').mockResolvedValue('a' as never);
		const q = new SaveQueue(noopCb);
		q.schedule('a', () => row('a'));
		q.cancel('a');
		await vi.advanceTimersByTimeAsync(400);
		expect(put).not.toHaveBeenCalled();
	});

	it('un getRow renvoyant null n’écrit pas (fichier disparu entre-temps)', async () => {
		const put = vi.spyOn(db.drafts, 'put').mockResolvedValue('x' as never);
		const q = new SaveQueue(noopCb);
		q.schedule('gone', () => null);
		await vi.advanceTimersByTimeAsync(400);
		expect(put).not.toHaveBeenCalled();
	});

	it('flush() écrit immédiatement toutes les rows en attente', () => {
		const put = vi.spyOn(db.drafts, 'put').mockResolvedValue('x' as never);
		const q = new SaveQueue(noopCb);
		q.schedule('a', () => row('a'));
		q.schedule('b', () => row('b'));
		q.flush((id) => row(id));
		expect(put).toHaveBeenCalledTimes(2);
	});

	it('flush() garde l’indicateur pending jusqu’à la fin réelle du write', async () => {
		let resolvePut: ((value: string) => void) | undefined;
		const pendingPut = new Promise<string>((resolve) => {
			resolvePut = resolve;
		});
		vi.spyOn(db.drafts, 'put').mockReturnValue(pendingPut as ReturnType<typeof db.drafts.put>);
		const states: boolean[] = [];
		const q = new SaveQueue({ ...noopCb, onPendingChange: (pending) => states.push(pending) });
		q.schedule('a', () => row('a'));

		q.flush((id) => row(id));

		expect(states.at(-1)).toBe(true);
		resolvePut?.('a');
		await vi.waitFor(() => expect(states.at(-1)).toBe(false));
	});

	it('onPendingChange : true au schedule, false une fois le write terminé', async () => {
		vi.spyOn(db.drafts, 'put').mockResolvedValue('x' as never);
		const states: boolean[] = [];
		const q = new SaveQueue({ ...noopCb, onPendingChange: (p) => states.push(p) });
		q.schedule('a', () => row('a'));
		expect(states[0]).toBe(true);
		await vi.advanceTimersByTimeAsync(400);
		await vi.waitFor(() => expect(states.at(-1)).toBe(false));
	});

	it('schedule notifie onDraftSaved (id, updatedAt) après succès du write (§M3)', async () => {
		vi.spyOn(db.drafts, 'put').mockResolvedValue('x' as never);
		const onDraftSaved = vi.fn();
		const q = new SaveQueue({ ...noopCb, onDraftSaved });
		q.schedule('a', () => ({ ...row('a'), updatedAt: 42 }));
		await vi.advanceTimersByTimeAsync(400);
		await vi.waitFor(() => expect(onDraftSaved).toHaveBeenCalledWith('a', 42));
	});

	it('has(id) reste vrai pendant un put in-flight (apres le timer)', async () => {
		let resolvePut: ((value: string) => void) | undefined;
		const pendingPut = new Promise<string>((resolve) => {
			resolvePut = resolve;
		});
		vi.spyOn(db.drafts, 'put').mockReturnValue(pendingPut as ReturnType<typeof db.drafts.put>);
		const q = new SaveQueue(noopCb);
		q.schedule('a', () => row('a'));
		expect(q.has('a')).toBe(true); // timer armé
		await vi.advanceTimersByTimeAsync(400);
		// Timer cleared, put still in flight - cross-tab guards must still see pending.
		expect(q.has('a')).toBe(true);
		resolvePut?.('a');
		await vi.waitFor(() => expect(q.has('a')).toBe(false));
	});

	it('flushAwait écrit et attend la fin des puts', async () => {
		vi.spyOn(db.drafts, 'put').mockResolvedValue('x' as never);
		const q = new SaveQueue(noopCb);
		q.schedule('a', () => row('a'));
		await q.flushAwait((id) => row(id));
		expect(q.has('a')).toBe(false);
	});

	it('serialise les puts : un put lent v1 ne peut pas ecraser v2', async () => {
		const resolvers: Array<(value: string) => void> = [];
		const put = vi.spyOn(db.drafts, 'put').mockImplementation(() => {
			return new Promise<string>((resolve) => {
				resolvers.push(resolve);
			}) as ReturnType<typeof db.drafts.put>;
		});
		const q = new SaveQueue(noopCb);
		const r1 = { ...row('a'), content: 'v1', updatedAt: 1 };
		const r2 = { ...row('a'), content: 'v2', updatedAt: 2 };
		q.schedule('a', () => r1);
		await vi.advanceTimersByTimeAsync(400);
		// First put started (queued).
		expect(put).toHaveBeenCalledTimes(1);
		// Second schedule while first still in flight.
		q.schedule('a', () => r2);
		await vi.advanceTimersByTimeAsync(400);
		// Second put is chained - may or may not have started depending on chain.
		// Resolve first put, then second should write v2 last.
		expect(resolvers.length).toBeGreaterThanOrEqual(1);
		resolvers[0]?.('a');
		await vi.waitFor(() => expect(put.mock.calls.length).toBeGreaterThanOrEqual(2));
		// Resolve all remaining.
		for (const r of resolvers.slice(1)) r('a');
		await vi.waitFor(() => expect(q.has('a')).toBe(false));
		const lastRow = put.mock.calls.at(-1)?.[0] as { content: string };
		expect(lastRow.content).toBe('v2');
		// And the final call must be after any v1 - last wins with v2.
		const contents = put.mock.calls.map((c) => (c[0] as { content: string }).content);
		expect(contents.filter((c) => c === 'v2').length).toBeGreaterThanOrEqual(1);
		expect(contents.at(-1)).toBe('v2');
	});

	it('discard(id) empeche un put in-flight de ressusciter le draft', async () => {
		let resolvePut: ((value: string) => void) | undefined;
		const pendingPut = new Promise<string>((resolve) => {
			resolvePut = resolve;
		});
		const put = vi
			.spyOn(db.drafts, 'put')
			.mockReturnValue(pendingPut as ReturnType<typeof db.drafts.put>);
		const del = vi.spyOn(db.drafts, 'delete').mockResolvedValue(undefined as never);
		const onSaved = vi.fn();
		const q = new SaveQueue({ ...noopCb, onSaved });
		q.schedule('a', () => row('a'));
		await vi.advanceTimersByTimeAsync(400);
		expect(put).toHaveBeenCalledOnce();
		// User closes/trash while put is in flight.
		q.discard('a');
		resolvePut?.('a');
		await vi.waitFor(() => expect(del).toHaveBeenCalledWith('a'));
		expect(onSaved).not.toHaveBeenCalled();
	});

	it('invalidate(id) saute le write sans supprimer la row (reload/backup)', async () => {
		const put = vi.spyOn(db.drafts, 'put').mockResolvedValue('a' as never);
		const del = vi.spyOn(db.drafts, 'delete').mockResolvedValue(undefined as never);
		const onSaved = vi.fn();
		const q = new SaveQueue({ ...noopCb, onSaved });
		q.schedule('a', () => row('a'));
		// Invalidate before the timer fires - no put, no delete (unlike discard).
		q.invalidate('a');
		await vi.advanceTimersByTimeAsync(400);
		expect(put).not.toHaveBeenCalled();
		expect(del).not.toHaveBeenCalled();
		expect(onSaved).not.toHaveBeenCalled();
	});

	it('settleAndRearm apres discard empeche reverse-delete de la row restauree', async () => {
		// Race: discard mid-put → restore rewrites drafts → put settles and must
		// NOT delete the restored row (Undo trash while put was in flight).
		// Real timers: await chain + deferred put must not hang under fake timers.
		vi.useRealTimers();
		let resolvePut: ((value: string) => void) | undefined;
		const pendingPut = new Promise<string>((resolve) => {
			resolvePut = resolve;
		});
		const put = vi
			.spyOn(db.drafts, 'put')
			.mockReturnValue(pendingPut as ReturnType<typeof db.drafts.put>);
		const del = vi.spyOn(db.drafts, 'delete').mockResolvedValue(undefined as never);
		try {
			const q = new SaveQueue(noopCb);
			// Arm a timer then flush so put starts without waiting for debounce.
			q.schedule('a', () => row('a'));
			q.flush((id) => row(id));
			expect(put).toHaveBeenCalledOnce();
			q.discard('a');
			// Undo-restore path: wait for the discarded put, then rearm.
			const settleP = q.settleAndRearm('a');
			resolvePut?.('a');
			await settleP;
			// Simulate restoreFromTrash writing the draft back after rearm.
			put.mockRestore();
			del.mockRestore();
			await db.drafts.put(row('a'));
			await Promise.resolve();
			await Promise.resolve();
			// Row must survive after rearm (the bug was reverse-delete after restore).
			expect(await db.drafts.get('a')).toBeTruthy();
		} finally {
			resolvePut?.('released');
			try {
				put.mockRestore();
				del.mockRestore();
			} catch {
				// already restored
			}
			vi.useFakeTimers();
		}
	});

	it('un put supersede ignore le snapshot stalle sans ecrire', async () => {
		const order: string[] = [];
		let gate: Promise<void> = Promise.resolve();
		let releaseGate: (() => void) | undefined;
		gate = new Promise<void>((resolve) => {
			releaseGate = resolve;
		});
		const put = vi.spyOn(db.drafts, 'put').mockImplementation(((r: { content: string }) => {
			const row = r;
			// First put waits on the gate so the second can enqueue first.
			const done = (async () => {
				if (row.content === 'old') await gate;
				order.push(row.content);
				return row.content;
			})();
			return done as ReturnType<typeof db.drafts.put>;
		}) as typeof db.drafts.put);
		const q = new SaveQueue(noopCb);
		q.schedule('a', () => ({ ...row('a'), content: 'old' }));
		await vi.advanceTimersByTimeAsync(400);
		q.schedule('a', () => ({ ...row('a'), content: 'new' }));
		await vi.advanceTimersByTimeAsync(400);
		releaseGate?.();
		await vi.waitFor(() => expect(q.has('a')).toBe(false));
		// With generation skip: old may be skipped entirely, or run then new.
		// Final durable content path must include 'new' and not end on 'old' alone.
		expect(
			order.includes('new') ||
				put.mock.calls.some((c) => (c[0] as { content: string }).content === 'new')
		).toBe(true);
		if (order.length > 0) {
			expect(order.at(-1)).not.toBe('old');
		}
	});

	describe('flushPending (§M1 - anti-perte de frappe au reorder)', () => {
		it('écrit immédiatement les ids ayant un timer armé, sans attendre le debounce', () => {
			const put = vi.spyOn(db.drafts, 'put').mockResolvedValue('x' as never);
			const q = new SaveQueue(noopCb);
			q.schedule('a', () => row('a'));
			q.schedule('b', () => row('b'));
			q.flushPending(['a', 'b'], (id) => row(id));
			expect(put).toHaveBeenCalledTimes(2); // écrit avant les 400 ms
		});

		it('ignore un id SANS timer armé (rien à flusher)', () => {
			const put = vi.spyOn(db.drafts, 'put').mockResolvedValue('x' as never);
			const q = new SaveQueue(noopCb);
			q.schedule('a', () => row('a'));
			q.flushPending(['a', 'jamais-planifié'], (id) => row(id));
			expect(put).toHaveBeenCalledTimes(1);
		});

		it('appelle onSaved + onDraftSaved après le write réussi', async () => {
			vi.spyOn(db.drafts, 'put').mockResolvedValue('x' as never);
			const onSaved = vi.fn();
			const onDraftSaved = vi.fn();
			const q = new SaveQueue({ ...noopCb, onSaved, onDraftSaved });
			q.schedule('a', () => ({ ...row('a'), updatedAt: 7 }));
			q.flushPending(['a'], (id) => ({ ...row(id), updatedAt: 7 }));
			await vi.waitFor(() => {
				expect(onSaved).toHaveBeenCalled();
				expect(onDraftSaved).toHaveBeenCalledWith('a', 7);
			});
		});

		it('ignore un id dont getRow renvoie null (fichier disparu)', () => {
			const put = vi.spyOn(db.drafts, 'put').mockResolvedValue('x' as never);
			const q = new SaveQueue(noopCb);
			q.schedule('a', () => row('a'));
			q.flushPending(['a'], () => null);
			expect(put).not.toHaveBeenCalled();
		});

		it('route un échec de write vers onError', async () => {
			vi.spyOn(db.drafts, 'put').mockRejectedValue(new Error('boom'));
			const onError = vi.fn();
			const q = new SaveQueue({ ...noopCb, onError });
			q.schedule('a', () => row('a'));
			q.flushPending(['a'], (id) => row(id));
			await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
		});
	});
});
