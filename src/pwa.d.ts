// §1.2 - Ambient declaration of the virtual module injected by vite-plugin-pwa
// at build. File with no import/export (ambient script) so the declaration is
// global and reliable - `svelte-check` does not resolve the module otherwise.
// Minimal self-contained form (no dependency on the package types). The module
// only exists at PWA build; we import it dynamically, guarded with `browser` +
// try/catch (cf. src/lib/ui/pwa-update.ts).

declare module 'virtual:pwa-register' {
	export interface RegisterSWOptions {
		immediate?: boolean;
		onNeedRefresh?: () => void;
		onOfflineReady?: () => void;
		onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
		onRegisteredSW?: (
			swScriptUrl: string,
			registration: ServiceWorkerRegistration | undefined
		) => void;
		onRegisterError?: (error: unknown) => void;
	}
	export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void>;
}
