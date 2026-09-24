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
});
