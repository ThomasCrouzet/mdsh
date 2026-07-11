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
