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

describe('locale - logique pure', () => {
	it('isLocale valide en/fr et rejette le reste', () => {
		expect(isLocale('en')).toBe(true);
		expect(isLocale('fr')).toBe(true);
		expect(isLocale('de')).toBe(false);
		expect(isLocale(null)).toBe(false);
		expect(isLocale(42)).toBe(false);
	});

	it('detectLocale : un choix persisté valide prime sur la langue du navigateur', () => {
		expect(detectLocale('fr-FR', 'en')).toBe('en');
		expect(detectLocale('en-US', 'fr')).toBe('fr');
	});

	it("detectLocale : suit navigator.language quand rien n'est persisté", () => {
		expect(detectLocale('fr-FR', null)).toBe('fr');
		expect(detectLocale('fr', undefined)).toBe('fr');
		expect(detectLocale('en-GB', null)).toBe('en');
		expect(detectLocale('de-DE', null)).toBe('en'); // repli anglais
		expect(detectLocale(undefined, null)).toBe('en');
	});

	it('detectLocale : un choix persisté invalide est ignoré', () => {
		expect(detectLocale('fr-FR', 'klingon')).toBe('fr');
		expect(detectLocale('en-US', 123)).toBe('en');
	});

	it('interpolate : remplit les placeholders, laisse les inconnus intacts', () => {
		expect(interpolate('Hello {name}', { name: 'world' })).toBe('Hello world');
		expect(interpolate('{n} file(s)', { n: 3 })).toBe('3 file(s)');
		expect(interpolate('no params')).toBe('no params');
		expect(interpolate('{missing} kept', {})).toBe('{missing} kept');
		expect(interpolate('{a} {b} {a}', { a: 'x', b: 'y' })).toBe('x y x');
	});

	it('LOCALE_LABELS couvre toutes les locales livrées', () => {
		for (const l of LOCALES) expect(LOCALE_LABELS[l]).toBeTruthy();
	});
});

describe('dictionnaires de messages', () => {
	it('en et fr ont exactement les mêmes clés', () => {
		expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
	});

	it('aucune valeur vide dans les deux locales', () => {
		for (const dict of [en, fr]) {
			for (const [key, value] of Object.entries(dict)) {
				expect(value, `clé vide: ${key}`).toBeTruthy();
			}
		}
	});

	it('DEFAULT_LOCALE est livrée', () => {
		expect(LOCALES).toContain(DEFAULT_LOCALE);
	});
});

describe('i18nStore.t', () => {
	beforeEach(() => {
		i18n.locale = 'en';
	});

	it('traduit dans la locale courante et réagit au changement', () => {
		expect(t('welcome.newFile')).toBe('New file');
		i18n.locale = 'fr';
		expect(t('welcome.newFile')).toBe('Nouveau fichier');
	});

	it('garde une chaîne non vide pour toute clé connue, dans chaque locale', () => {
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

	it('load : applique la locale persistée et met à jour <html lang>', () => {
		localStorage.setItem(LOCALE_STORAGE_KEY, 'fr');
		i18n.load();
		expect(i18n.locale).toBe('fr');
		expect(document.documentElement.lang).toBe('fr');
	});

	it('load : sans choix persisté, suit navigator.language', () => {
		const orig = Object.getOwnPropertyDescriptor(navigator, 'language');
		Object.defineProperty(navigator, 'language', { value: 'fr-FR', configurable: true });
		try {
			i18n.load();
			expect(i18n.locale).toBe('fr');
		} finally {
			if (orig) Object.defineProperty(navigator, 'language', orig);
		}
	});

	it('set : change la locale, persiste le choix et met à jour <html lang>', () => {
		i18n.set('fr');
		expect(i18n.locale).toBe('fr');
		expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('fr');
		expect(document.documentElement.lang).toBe('fr');
		i18n.set('en');
		expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
	});
});

it('annonce le changement de langue au menu natif', () => {
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
