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
	it('treats light and dark as explicit settings', () => {
		expect(resolveTheme('light', false)).toBe('light');
		expect(resolveTheme('light', true)).toBe('light');
		expect(resolveTheme('dark', true)).toBe('dark');
		expect(resolveTheme('dark', false)).toBe('dark');
	});

	it('follows the operating system for the system setting', () => {
		expect(resolveTheme('system', true)).toBe('light');
		expect(resolveTheme('system', false)).toBe('dark');
	});
});

describe('nextThemePref', () => {
	it('cycles through system, light, dark, and system', () => {
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
	it('accepts the three valid values', () => {
		expect(isThemePref('system')).toBe(true);
		expect(isThemePref('light')).toBe(true);
		expect(isThemePref('dark')).toBe(true);
	});
	it('rejects all other values', () => {
		expect(isThemePref('')).toBe(false);
		expect(isThemePref(null)).toBe(false);
		expect(isThemePref('Light')).toBe(false);
		expect(isThemePref(undefined)).toBe(false);
	});
});

describe('THEME_COLORS', () => {
	it('maps each effective theme to a system bar color', () => {
		expect(THEME_COLORS.dark).toBe('#0b0c0d');
		expect(THEME_COLORS.light).toBe('#f0ede5');
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
