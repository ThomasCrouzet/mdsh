import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notify } from '$lib/notify.svelte';

const pwa = vi.hoisted(() => ({
	options: null as {
		onNeedRefresh: () => void;
		onOfflineReady: () => void;
		onRegisteredSW: (url: string, registration?: { update: () => Promise<void> }) => void;
	} | null,
	update: vi.fn(async () => undefined),
	register: vi.fn()
}));

vi.mock('virtual:pwa-register', () => ({
	registerSW: pwa.register
}));

beforeEach(() => {
	notify.clear();
	pwa.options = null;
	pwa.update.mockClear();
	pwa.register.mockReset();
	pwa.register.mockImplementation((options) => {
		pwa.options = options;
		return pwa.update;
	});
});

describe('PWA update glue', () => {
	it('shows explicit update and offline-ready notifications', async () => {
		const { registerPwaUpdates } = await import('./pwa-update');
		registerPwaUpdates();
		await vi.waitFor(() => expect(pwa.register).toHaveBeenCalledOnce());

		pwa.options?.onNeedRefresh();
		expect(notify.toasts[0]?.action).toBeDefined();
		notify.toasts[0]?.action?.run();
		expect(pwa.update).toHaveBeenCalledWith(true);

		pwa.options?.onOfflineReady();
		expect(notify.toasts.some((toast) => toast.level === 'success')).toBe(true);
	});

	it('checks a long-lived registration periodically', async () => {
		vi.useFakeTimers();
		const registration = { update: vi.fn(async () => undefined) };
		const { registerPwaUpdates } = await import('./pwa-update');
		registerPwaUpdates();
		await vi.waitFor(() => expect(pwa.register).toHaveBeenCalledOnce());
		pwa.options?.onRegisteredSW('/sw.js', registration);
		await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
		expect(registration.update).toHaveBeenCalledOnce();
		vi.useRealTimers();
	});
});
