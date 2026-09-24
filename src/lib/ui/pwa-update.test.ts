import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
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
	vi.stubGlobal('navigator', { serviceWorker: {} });
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

afterEach(() => vi.unstubAllGlobals());

describe('PWA update glue', () => {
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
