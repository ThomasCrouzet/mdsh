import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { notify } from './notify.svelte';

describe('notify store', () => {
	beforeEach(() => {
		notify.clear();
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('ajoute un toast erreur avec le bon niveau', () => {
		notify.error('boom');
		expect(notify.toasts).toHaveLength(1);
		expect(notify.toasts[0]).toMatchObject({ level: 'error', message: 'boom' });
	});

	it('distingue les niveaux success / info / error', () => {
		notify.success('ok');
		notify.info('fyi');
		notify.error('bad');
		expect(notify.toasts.map((t) => t.level)).toEqual(['success', 'info', 'error']);
	});

	it('attribue des ids croissants et uniques', () => {
		const a = notify.info('a');
		const b = notify.info('b');
		expect(b).toBeGreaterThan(a);
		expect(notify.toasts[0]!.id).not.toBe(notify.toasts[1]!.id);
	});

	it('déduplique un (level, message) identique sans créer de doublon', () => {
		const first = notify.error('quota plein');
		const second = notify.error('quota plein');
		expect(first).toBe(second);
		expect(notify.toasts).toHaveLength(1);
	});

	it('ne déduplique pas si le message diffère ou si le niveau diffère', () => {
		notify.error('msg');
		notify.error('autre');
		notify.info('msg');
		expect(notify.toasts).toHaveLength(3);
	});

	it('auto-ferme un toast erreur après son TTL (8 s)', () => {
		notify.error('boom');
		expect(notify.toasts).toHaveLength(1);
		vi.advanceTimersByTime(7999);
		expect(notify.toasts).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(notify.toasts).toHaveLength(0);
	});

	it('auto-ferme un succès plus tôt (3,5 s) qu’une erreur', () => {
		notify.success('ok');
		vi.advanceTimersByTime(3500);
		expect(notify.toasts).toHaveLength(0);
	});

	it('la dédup relance le minuteur (le toast survit au-delà du TTL initial)', () => {
		notify.error('rep');
		vi.advanceTimersByTime(5000);
		notify.error('rep'); // re-arme à 8 s depuis maintenant
		vi.advanceTimersByTime(5000); // total 10 s, mais re-armé à t=5s
		expect(notify.toasts).toHaveLength(1);
		vi.advanceTimersByTime(3000); // 8 s après le re-arm
		expect(notify.toasts).toHaveLength(0);
	});

	it('actionable() crée un toast info persistant (pas d’auto-fermeture)', () => {
		notify.actionable('Nouvelle version', { label: 'Recharger', run: () => {} });
		expect(notify.toasts).toHaveLength(1);
		expect(notify.toasts[0]).toMatchObject({ level: 'info', message: 'Nouvelle version' });
		expect(notify.toasts[0]?.action?.label).toBe('Recharger');
		// TTL 0 → aucun minuteur : le toast survit indéfiniment.
		vi.advanceTimersByTime(60_000);
		expect(notify.toasts).toHaveLength(1);
	});

	it('l’action d’un toast peut être déclenchée puis dismiss', () => {
		const run = vi.fn();
		const id = notify.actionable('msg', { label: 'OK', run });
		notify.toasts[0]?.action?.run();
		expect(run).toHaveBeenCalledOnce();
		notify.dismiss(id);
		expect(notify.toasts).toHaveLength(0);
	});

	it('dismiss(id) retire le toast ciblé immédiatement', () => {
		const id = notify.info('x');
		notify.dismiss(id);
		expect(notify.toasts).toHaveLength(0);
	});

	it('clear() vide tous les toasts et leurs minuteurs', () => {
		notify.error('a');
		notify.success('b');
		notify.clear();
		expect(notify.toasts).toHaveLength(0);
		// Aucun minuteur résiduel ne doit ré-affecter le state.
		vi.advanceTimersByTime(10000);
		expect(notify.toasts).toHaveLength(0);
	});
});
