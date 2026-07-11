import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { themeStore } from './theme.svelte';
import { THEME_STORAGE_KEY, THEME_COLORS } from '$lib/theme';

// jsdom n'implémente pas matchMedia : on injecte un MediaQueryList contrôlable
// pour piloter la préférence système (clair / sombre) et déclencher l'événement
// `change` que `themeStore` écoute quand la préférence vaut `system`.
let mqlMatches = false;
const listeners = new Set<(e: MediaQueryListEvent) => void>();
const mql = {
	get matches() {
		return mqlMatches;
	},
	media: '(prefers-color-scheme: light)',
	addEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) => listeners.add(cb),
	removeEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) => listeners.delete(cb)
} as unknown as MediaQueryList;

function setSystemLight(light: boolean): void {
	mqlMatches = light;
	for (const cb of listeners) cb({ matches: light } as MediaQueryListEvent);
}

function metaContent(name: string): string | null | undefined {
	return document.querySelector(`meta[name="${name}"]`)?.getAttribute('content');
}

beforeAll(() => {
	(window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = () => mql;
	for (const name of ['theme-color', 'color-scheme']) {
		if (!document.querySelector(`meta[name="${name}"]`)) {
			const m = document.createElement('meta');
			m.setAttribute('name', name);
			document.head.appendChild(m);
		}
	}
});

beforeEach(() => {
	localStorage.clear();
	mqlMatches = false; // système = sombre par défaut
	themeStore.pref = 'system';
	document.documentElement.removeAttribute('data-theme');
});

describe('themeStore', () => {
	it('load sans préférence persistée : suit le système (sombre par défaut)', () => {
		themeStore.load();
		expect(themeStore.pref).toBe('system');
		expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
		expect(metaContent('theme-color')).toBe(THEME_COLORS.dark);
		expect(metaContent('color-scheme')).toBe('dark');
	});

	it('load : système en clair applique le thème clair', () => {
		mqlMatches = true;
		themeStore.load();
		expect(document.documentElement.getAttribute('data-theme')).toBe('light');
		expect(metaContent('theme-color')).toBe(THEME_COLORS.light);
	});

	it('load : une préférence persistée absolue prime sur le système', () => {
		localStorage.setItem(THEME_STORAGE_KEY, 'dark');
		mqlMatches = true; // système clair, mais pref dark absolue
		themeStore.load();
		expect(themeStore.pref).toBe('dark');
		expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
	});

	it('load : une valeur localStorage invalide est ignorée (reste system)', () => {
		localStorage.setItem(THEME_STORAGE_KEY, 'rainbow');
		themeStore.load();
		expect(themeStore.pref).toBe('system');
	});

	it('set : applique, persiste et met à jour les metas', () => {
		themeStore.set('light');
		expect(themeStore.pref).toBe('light');
		expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
		expect(document.documentElement.getAttribute('data-theme')).toBe('light');
		expect(metaContent('theme-color')).toBe(THEME_COLORS.light);

		themeStore.set('dark');
		expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
		expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
	});

	it('cycle : système -> clair -> sombre -> système', () => {
		themeStore.pref = 'system';
		themeStore.cycle();
		expect(themeStore.pref).toBe('light');
		themeStore.cycle();
		expect(themeStore.pref).toBe('dark');
		themeStore.cycle();
		expect(themeStore.pref).toBe('system');
	});

	it("suit les bascules de l'OS quand la préférence vaut system", () => {
		themeStore.load();
		expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
		setSystemLight(true);
		expect(document.documentElement.getAttribute('data-theme')).toBe('light');
		setSystemLight(false);
		expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
	});

	it("ignore les bascules de l'OS quand une préférence absolue est fixée", () => {
		themeStore.load();
		themeStore.set('dark');
		setSystemLight(true); // l'OS passe en clair
		expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
	});
});
