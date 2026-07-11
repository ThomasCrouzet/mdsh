// Pure locale logic (no rune, testable in isolation), modeled on `theme.ts`.
// The i18n layer is 100% client-side / offline: both locales (en + fr) are
// bundled together, no network fetch.
//
// Default: English (default locale of the open source project). French remains
// available as a second locale, selectable in the Settings and detected
// automatically on first launch via `navigator.language`.

export type Locale = 'en' | 'fr';

/** Shipped locales, in the selector's display order. */
export const LOCALES = ['en', 'fr'] as const;

/** Default locale (server / prerender render, and first client render). */
export const DEFAULT_LOCALE: Locale = 'en';

/** localStorage key for the explicit language choice. */
export const LOCALE_STORAGE_KEY = 'mdsh:locale';

/** Native label of each locale (for the language selector). */
export const LOCALE_LABELS: Record<Locale, string> = {
	en: 'English',
	fr: 'Français'
};

/** Type guard: validates a value read from localStorage or elsewhere. */
export function isLocale(v: unknown): v is Locale {
	return v === 'en' || v === 'fr';
}

/**
 * Resolves the initial locale: a persisted explicit choice wins; otherwise we
 * follow the browser language (`fr*` -> French), falling back to English.
 * Pure (injected inputs) to stay testable outside the browser.
 */
export function detectLocale(navigatorLang: string | undefined, saved: unknown): Locale {
	if (isLocale(saved)) return saved;
	const lang = (navigatorLang ?? '').toLowerCase();
	return lang.startsWith('fr') ? 'fr' : 'en';
}

/**
 * Replaces a message's `{name}` placeholders with the values from `params`.
 * Pure: a placeholder without a matching value is left as is.
 */
export function interpolate(template: string, params?: Record<string, string | number>): string {
	if (!params) return template;
	return template.replace(/\{(\w+)\}/g, (match, key) =>
		key in params ? String(params[key]) : match
	);
}
