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

	it('adds an error toast with the correct level', () => {
		notify.error('boom');
		expect(notify.toasts).toHaveLength(1);
		expect(notify.toasts[0]).toMatchObject({ level: 'error', message: 'boom' });
	});

	it('keeps success, info, and error levels separate', () => {
		notify.success('ok');
		notify.info('fyi');
		notify.error('bad');
		expect(notify.toasts.map((t) => t.level)).toEqual(['success', 'info', 'error']);
	});

	it('assigns increasing unique IDs', () => {
		const a = notify.info('a');
		const b = notify.info('b');
		expect(b).toBeGreaterThan(a);
		expect(notify.toasts[0]!.id).not.toBe(notify.toasts[1]!.id);
	});

	it('deduplicates an identical level and message', () => {
		const first = notify.error('quota plein');
		const second = notify.error('quota plein');
		expect(first).toBe(second);
		expect(notify.toasts).toHaveLength(1);
	});

	it('does not deduplicate a different message or level', () => {
		notify.error('msg');
		notify.error('autre');
		notify.info('msg');
		expect(notify.toasts).toHaveLength(3);
	});

	it('closes an error toast after its eight-second TTL', () => {
		notify.error('boom');
		expect(notify.toasts).toHaveLength(1);
		vi.advanceTimersByTime(7999);
		expect(notify.toasts).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(notify.toasts).toHaveLength(0);
	});

	it('closes a success toast before an error toast', () => {
		notify.success('ok');
		vi.advanceTimersByTime(3500);
		expect(notify.toasts).toHaveLength(0);
	});

	it('restarts the timer after deduplication', () => {
		notify.error('rep');
		vi.advanceTimersByTime(5000);
		notify.error('rep'); // re-arme à 8 s depuis maintenant
		vi.advanceTimersByTime(5000); // total 10 s, mais re-armé à t=5s
		expect(notify.toasts).toHaveLength(1);
		vi.advanceTimersByTime(3000); // 8 s après le re-arm
		expect(notify.toasts).toHaveLength(0);
	});

	it('creates a persistent info toast with actionable', () => {
		notify.actionable('Nouvelle version', { label: 'Recharger', run: () => {} });
		expect(notify.toasts).toHaveLength(1);
		expect(notify.toasts[0]).toMatchObject({ level: 'info', message: 'Nouvelle version' });
		expect(notify.toasts[0]?.action?.label).toBe('Recharger');
		// A zero TTL creates no timer, so the toast stays visible.
		vi.advanceTimersByTime(60_000);
		expect(notify.toasts).toHaveLength(1);
	});

	it('runs a toast action and then dismisses it', () => {
		const run = vi.fn();
		const id = notify.actionable('msg', { label: 'OK', run });
		notify.toasts[0]?.action?.run();
		expect(run).toHaveBeenCalledOnce();
		notify.dismiss(id);
		expect(notify.toasts).toHaveLength(0);
	});

	it('removes the selected toast immediately with dismiss', () => {
		const id = notify.info('x');
		notify.dismiss(id);
		expect(notify.toasts).toHaveLength(0);
	});

	it('removes all toasts and timers with clear', () => {
		notify.error('a');
		notify.success('b');
		notify.clear();
		expect(notify.toasts).toHaveLength(0);
		// No remaining timer can change the state.
		vi.advanceTimersByTime(10000);
		expect(notify.toasts).toHaveLength(0);
	});
});
