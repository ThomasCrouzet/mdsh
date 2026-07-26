import { describe, it, expect } from 'vitest';
import {
	isThemePref,
	mermaidThemeFromDataTheme,
	nextThemePref,
	resolveTheme,
	THEME_COLORS,
	type ThemePref
} from './theme';

describe('resolveTheme', () => {
	it('light/dark sont absolus (ignorent le système)', () => {
		expect(resolveTheme('light', false)).toBe('light');
		expect(resolveTheme('light', true)).toBe('light');
		expect(resolveTheme('dark', true)).toBe('dark');
		expect(resolveTheme('dark', false)).toBe('dark');
	});

	it('system suit la préférence OS', () => {
		expect(resolveTheme('system', true)).toBe('light');
		expect(resolveTheme('system', false)).toBe('dark');
	});
});

describe('nextThemePref', () => {
	it('cycle système → clair → sombre → système', () => {
		let p: ThemePref = 'system';
		p = nextThemePref(p);
		expect(p).toBe('light');
		p = nextThemePref(p);
		expect(p).toBe('dark');
		p = nextThemePref(p);
		expect(p).toBe('system');
	});
});

describe('isThemePref', () => {
	it('accepte les 3 valeurs valides', () => {
		expect(isThemePref('system')).toBe(true);
		expect(isThemePref('light')).toBe(true);
		expect(isThemePref('dark')).toBe(true);
	});
	it('rejette tout le reste', () => {
		expect(isThemePref('')).toBe(false);
		expect(isThemePref(null)).toBe(false);
		expect(isThemePref('Light')).toBe(false);
		expect(isThemePref(undefined)).toBe(false);
	});
});

describe('THEME_COLORS', () => {
	it('mappe chaque thème effectif à une couleur barre système', () => {
		expect(THEME_COLORS.dark).toBe('#14161a');
		expect(THEME_COLORS.light).toBe('#fbfbfa');
	});
});

describe('mermaidThemeFromDataTheme', () => {
	it('light UI → Mermaid default (light palette)', () => {
		expect(mermaidThemeFromDataTheme('light')).toBe('default');
	});

	it('dark UI → Mermaid dark', () => {
		expect(mermaidThemeFromDataTheme('dark')).toBe('dark');
	});

	it('unset / unknown → dark (app default is dark-mode-first)', () => {
		expect(mermaidThemeFromDataTheme(null)).toBe('dark');
		expect(mermaidThemeFromDataTheme(undefined)).toBe('dark');
		expect(mermaidThemeFromDataTheme('')).toBe('dark');
	});
});
