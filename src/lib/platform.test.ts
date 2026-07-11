import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// `isMac` est une fonction qui lit navigator.platform au moment de l'appel -
// on peut donc mocker navigator avant chaque test sans besoin de re-importer.
import { isMac, modKey, shiftKey, formatKbd } from './platform';

// Sauvegarde de la valeur d'origine de navigator pour restauration propre.
const originalNavigator = globalThis.navigator;

function setNavPlatform(platform: string, userAgent = 'Mozilla/5.0') {
	vi.stubGlobal('navigator', {
		...originalNavigator,
		platform,
		userAgent
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('isMac', () => {
	it('retourne true sur MacIntel (Intel Mac)', () => {
		setNavPlatform('MacIntel');
		expect(isMac()).toBe(true);
	});

	it('retourne true sur MacArm / Apple Silicon (platform contient "Mac")', () => {
		setNavPlatform('MacArm');
		expect(isMac()).toBe(true);
	});

	it('retourne true sur iPhone (platform contient "iPhone")', () => {
		setNavPlatform('iPhone');
		expect(isMac()).toBe(true);
	});

	it('retourne true sur iPad (platform contient "iPad")', () => {
		setNavPlatform('iPad');
		expect(isMac()).toBe(true);
	});

	it('retourne false sur Win32', () => {
		setNavPlatform('Win32');
		expect(isMac()).toBe(false);
	});

	it('retourne false sur Linux x86_64', () => {
		setNavPlatform('Linux x86_64');
		expect(isMac()).toBe(false);
	});

	it('retourne false sur Linux armv7l', () => {
		setNavPlatform('Linux armv7l');
		expect(isMac()).toBe(false);
	});

	it('utilise le fallback userAgent si platform est vide et userAgent contient Mac', () => {
		setNavPlatform('', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/537.36');
		expect(isMac()).toBe(true);
	});

	it('retourne false si platform et userAgent ne contiennent pas Mac/iPhone/iPad', () => {
		setNavPlatform('', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124');
		expect(isMac()).toBe(false);
	});
});

describe('modKey', () => {
	it("retourne '⌘' sur Mac", () => {
		setNavPlatform('MacIntel');
		expect(modKey()).toBe('⌘');
	});

	it("retourne 'Ctrl' sur Windows", () => {
		setNavPlatform('Win32');
		expect(modKey()).toBe('Ctrl');
	});

	it("retourne 'Ctrl' sur Linux", () => {
		setNavPlatform('Linux x86_64');
		expect(modKey()).toBe('Ctrl');
	});
});

describe('shiftKey', () => {
	it("retourne '⇧' sur Mac", () => {
		setNavPlatform('MacIntel');
		expect(shiftKey()).toBe('⇧');
	});

	it("retourne 'Shift' sur Windows", () => {
		setNavPlatform('Win32');
		expect(shiftKey()).toBe('Shift');
	});
});

describe('formatKbd', () => {
	describe('sur Mac', () => {
		beforeEach(() => setNavPlatform('MacIntel'));

		it("retourne le raccourci Mac inchangé pour '⌘⇧P'", () => {
			expect(formatKbd('⌘⇧P')).toBe('⌘⇧P');
		});

		it("retourne '⌘N' inchangé", () => {
			expect(formatKbd('⌘N')).toBe('⌘N');
		});

		it("retourne '⌘⇧S' inchangé", () => {
			expect(formatKbd('⌘⇧S')).toBe('⌘⇧S');
		});
	});

	describe('sur Windows/Linux', () => {
		beforeEach(() => setNavPlatform('Win32'));

		it("traduit '⌘⇧P' → 'Ctrl+Shift+P'", () => {
			expect(formatKbd('⌘⇧P')).toBe('Ctrl+Shift+P');
		});

		it("traduit '⌘N' → 'Ctrl+N'", () => {
			expect(formatKbd('⌘N')).toBe('Ctrl+N');
		});

		it("traduit '⌘⇧S' → 'Ctrl+Shift+S'", () => {
			expect(formatKbd('⌘⇧S')).toBe('Ctrl+Shift+S');
		});

		it("traduit '⌥⌘I' → 'Alt+Ctrl+I' (sans double '+')", () => {
			const result = formatKbd('⌥⌘I');
			expect(result).toBe('Alt+Ctrl+I');
			expect(result).not.toContain('++');
		});

		it("traduit '⌘F' → 'Ctrl+F'", () => {
			expect(formatKbd('⌘F')).toBe('Ctrl+F');
		});
	});
});
