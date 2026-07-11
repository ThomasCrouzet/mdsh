// §1.2 - Visible PWA update flow.
//
// In `registerType: 'prompt'` mode (cf. vite.config), the service worker
// no longer overwrites the app silently: when a new version is ready,
// `onNeedRefresh` fires and we offer an actionable reload toast.
// This is the right behavior for an EDITOR: no surprise reload that could
// happen mid-typing.
//
// The virtual module `virtual:pwa-register` only exists in the PWA build -
// we import it dynamically, guarded by `browser` + fail-soft try/catch, to
// never break dev/SSR/tests.

import { browser } from '$app/environment';
import { t } from '$lib/i18n';
import { notify } from '$lib/notify.svelte';

export function registerPwaUpdates(): void {
	if (!browser) return;
	void (async () => {
		try {
			const { registerSW } = await import('virtual:pwa-register');
			const updateSW = registerSW({
				immediate: true,
				onNeedRefresh() {
					notify.actionable(t('pwa.updateAvailable'), {
						label: t('pwa.reload'),
						run: () => void updateSW(true)
					});
				},
				onOfflineReady() {
					notify.success(t('pwa.offlineReady'));
				},
				onRegisteredSW(_swUrl, registration) {
					// Without a periodic check, an editing session left open for several
					// days never discovers a new version: the reload toast only
					// fires on a change detected by the browser (often at the next load).
					// We poll every hour so the voluntary update flow can actually happen
					// in a long session, without ever reloading mid-typing.
					if (registration) {
						setInterval(() => void registration.update(), 60 * 60 * 1000);
					}
				}
			});
		} catch {
			// Virtual module absent (dev without SW, build without PWA) - silent.
		}
	})();
}
