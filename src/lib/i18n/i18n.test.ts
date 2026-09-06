import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	detectLocale,
	isLocale,
	interpolate,
	DEFAULT_LOCALE,
	LOCALE_STORAGE_KEY,
	LOCALES,
	LOCALE_LABELS
} from './locale';
import { en } from './messages/en';
import { fr } from './messages/fr';
import { i18n, t } from './i18n.svelte';

describe('locale - pure logic', () => {
	it('accepts English and French locales and rejects other values', () => {
		expect(isLocale('en')).toBe(true);
		expect(isLocale('fr')).toBe(true);
		expect(isLocale('de')).toBe(false);
		expect(isLocale(null)).toBe(false);
		expect(isLocale(42)).toBe(false);
	});

	it('uses a valid stored locale before the browser language', () => {
		expect(detectLocale('fr-FR', 'en')).toBe('en');
		expect(detectLocale('en-US', 'fr')).toBe('fr');
	});

	it('uses navigator.language without a stored locale', () => {
		expect(detectLocale('fr-FR', null)).toBe('fr');
		expect(detectLocale('fr', undefined)).toBe('fr');
		expect(detectLocale('en-GB', null)).toBe('en');
		expect(detectLocale('de-DE', null)).toBe('en'); // repli anglais
		expect(detectLocale(undefined, null)).toBe('en');
	});

	it('ignores an invalid stored locale', () => {
		expect(detectLocale('fr-FR', 'klingon')).toBe('fr');
		expect(detectLocale('en-US', 123)).toBe('en');
	});

	it('fills known placeholders and keeps unknown placeholders', () => {
		expect(interpolate('Hello {name}', { name: 'world' })).toBe('Hello world');
		expect(interpolate('{n} file(s)', { n: 3 })).toBe('3 file(s)');
		expect(interpolate('no params')).toBe('no params');
		expect(interpolate('{missing} kept', {})).toBe('{missing} kept');
		expect(interpolate('{a} {b} {a}', { a: 'x', b: 'y' })).toBe('x y x');
	});

	it('provides a label for each shipped locale', () => {
		for (const l of LOCALES) expect(LOCALE_LABELS[l]).toBeTruthy();
	});
});

describe('message dictionaries', () => {
	it('uses the same keys in English and French', () => {
		expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
	});

	it('has no empty value in either locale', () => {
		for (const dict of [en, fr]) {
			for (const [key, value] of Object.entries(dict)) {
				expect(value, `clé vide: ${key}`).toBeTruthy();
			}
		}
	});

	it('ships DEFAULT_LOCALE', () => {
		expect(LOCALES).toContain(DEFAULT_LOCALE);
	});
});

describe('i18nStore.t', () => {
	beforeEach(() => {
		i18n.locale = 'en';
	});

	it('translates in the current locale and reacts to changes', () => {
		expect(t('welcome.newFile')).toBe('New file');
		i18n.locale = 'fr';
		expect(t('welcome.newFile')).toBe('Nouveau fichier');
	});

	it('returns a non-empty string for each known key in each locale', () => {
		for (const locale of LOCALES) {
			i18n.locale = locale;
			for (const key of Object.keys(en) as (keyof typeof en)[]) {
				expect(t(key), `${locale}/${key}`).toBeTruthy();
			}
		}
	});
});

describe('i18nStore.load / set (browser)', () => {
	beforeEach(() => {
		localStorage.clear();
		i18n.locale = 'en';
	});
	afterEach(() => {
		localStorage.clear();
	});

	it('loads the stored locale and updates the HTML language', () => {
		localStorage.setItem(LOCALE_STORAGE_KEY, 'fr');
		i18n.load();
		expect(i18n.locale).toBe('fr');
		expect(document.documentElement.lang).toBe('fr');
	});

	it('uses navigator.language without a stored locale', () => {
		const orig = Object.getOwnPropertyDescriptor(navigator, 'language');
		Object.defineProperty(navigator, 'language', { value: 'fr-FR', configurable: true });
		try {
			i18n.load();
			expect(i18n.locale).toBe('fr');
		} finally {
			if (orig) Object.defineProperty(navigator, 'language', orig);
		}
	});

	it('sets and persists the locale and updates the HTML language', () => {
		i18n.set('fr');
		expect(i18n.locale).toBe('fr');
		expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('fr');
		expect(document.documentElement.lang).toBe('fr');
		i18n.set('en');
		expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
	});
});

it('reports a language change to the native menu', () => {
	let detail: unknown;
	const listener = (event: Event) => {
		detail = (event as CustomEvent).detail;
	};
	window.addEventListener('mdsh:locale-change', listener);
	try {
		i18n.set('fr');
		expect(detail).toEqual({ locale: 'fr' });
	} finally {
		window.removeEventListener('mdsh:locale-change', listener);
	}
});
