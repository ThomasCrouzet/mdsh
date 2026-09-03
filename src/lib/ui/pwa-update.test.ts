import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notify } from '$lib/notify.svelte';

const pwa = vi.hoisted(() => ({
	options: null as {
		onNeedRefresh: () => void;
		onNeedReload: () => void;
		onOfflineReady: () => void;
		onRegisteredSW: (url: string, registration?: { update: () => Promise<void> }) => void;
	} | null,
	update: vi.fn(async () => undefined),
	flush: vi.fn(async () => undefined),
	register: vi.fn()
}));

vi.mock('virtual:pwa-register', () => ({
	registerSW: pwa.register
}));

vi.mock('$lib/files.svelte', () => ({
	filesStore: { flushPendingAwait: pwa.flush }
}));

beforeEach(() => {
	notify.clear();
	pwa.options = null;
	pwa.update.mockClear();
	pwa.flush.mockReset().mockResolvedValue(undefined);
	pwa.register.mockReset();
	pwa.register.mockImplementation((options) => {
		pwa.options = options;
		return pwa.update;
	});
});

describe('PWA update glue', () => {
	it('attend la fin réelle des écritures avant activation', async () => {
		const { applyPwaUpdate } = await import('./pwa-update');
		let release: (() => void) | undefined;
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		const update = vi.fn(async () => undefined);
		const result = applyPwaUpdate(update, () => pending);
		expect(update).not.toHaveBeenCalled();
		release?.();
		await expect(result).resolves.toBe(true);
		expect(update).toHaveBeenCalledWith(true);
	});

	it('reste sur la page si la barrière de durabilité échoue', async () => {
		const { applyPwaUpdate } = await import('./pwa-update');
		const update = vi.fn(async () => undefined);
		await expect(
			applyPwaUpdate(update, async () => {
				throw new Error('quota');
			})
		).resolves.toBe(false);
		expect(update).not.toHaveBeenCalled();
		expect(notify.toasts.some((toast) => toast.level === 'error')).toBe(true);
	});

	it('shows explicit update and offline-ready notifications', async () => {
		const { registerPwaUpdates } = await import('./pwa-update');
		registerPwaUpdates();
		await vi.waitFor(() => expect(pwa.register).toHaveBeenCalledOnce());

		pwa.options?.onNeedRefresh();
		expect(notify.toasts[0]?.action).toBeDefined();
		notify.toasts[0]?.action?.run();
		await vi.waitFor(() => expect(pwa.update).toHaveBeenCalledWith(true));
		expect(pwa.flush).toHaveBeenCalledOnce();
		expect(pwa.options?.onNeedReload).toBeTypeOf('function');

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
