import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// `isMac` reads navigator.platform at call time. Mock navigator before each test
// without importing the module again.
import { isMac, modKey, shiftKey, formatKbd } from './platform';

// Save the original navigator value for cleanup.
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
	it('returns true for MacIntel', () => {
		setNavPlatform('MacIntel');
		expect(isMac()).toBe(true);
	});

	it('returns true for MacArm on Apple Silicon', () => {
		setNavPlatform('MacArm');
		expect(isMac()).toBe(true);
	});

	it('returns true for iPhone', () => {
		setNavPlatform('iPhone');
		expect(isMac()).toBe(true);
	});

	it('returns true for iPad', () => {
		setNavPlatform('iPad');
		expect(isMac()).toBe(true);
	});

	it('returns false for Win32', () => {
		setNavPlatform('Win32');
		expect(isMac()).toBe(false);
	});

	it('returns false for Linux x86_64', () => {
		setNavPlatform('Linux x86_64');
		expect(isMac()).toBe(false);
	});

	it('returns false for Linux armv7l', () => {
		setNavPlatform('Linux armv7l');
		expect(isMac()).toBe(false);
	});

	it('uses userAgent when platform is empty', () => {
		setNavPlatform('', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/537.36');
		expect(isMac()).toBe(true);
	});

	it('returns false when platform and userAgent do not identify an Apple device', () => {
		setNavPlatform('', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124');
		expect(isMac()).toBe(false);
	});
});

describe('modKey', () => {
	it("returns '⌘' on Mac", () => {
		setNavPlatform('MacIntel');
		expect(modKey()).toBe('⌘');
	});

	it("returns 'Ctrl' on Windows", () => {
		setNavPlatform('Win32');
		expect(modKey()).toBe('Ctrl');
	});

	it("returns 'Ctrl' on Linux", () => {
		setNavPlatform('Linux x86_64');
		expect(modKey()).toBe('Ctrl');
	});
});

describe('shiftKey', () => {
	it("returns '⇧' on Mac", () => {
		setNavPlatform('MacIntel');
		expect(shiftKey()).toBe('⇧');
	});

	it("returns 'Shift' on Windows", () => {
		setNavPlatform('Win32');
		expect(shiftKey()).toBe('Shift');
	});
});

describe('formatKbd', () => {
	describe('on Mac', () => {
		beforeEach(() => setNavPlatform('MacIntel'));

		it("keeps the Mac shortcut '⌘⇧P'", () => {
			expect(formatKbd('⌘⇧P')).toBe('⌘⇧P');
		});

		it("keeps '⌘N'", () => {
			expect(formatKbd('⌘N')).toBe('⌘N');
		});

		it("keeps '⌘⇧S'", () => {
			expect(formatKbd('⌘⇧S')).toBe('⌘⇧S');
		});
	});

	describe('on Windows and Linux', () => {
		beforeEach(() => setNavPlatform('Win32'));

		it("converts '⌘⇧P' to 'Ctrl+Shift+P'", () => {
			expect(formatKbd('⌘⇧P')).toBe('Ctrl+Shift+P');
		});

		it("converts '⌘N' to 'Ctrl+N'", () => {
			expect(formatKbd('⌘N')).toBe('Ctrl+N');
		});

		it("converts '⌘⇧S' to 'Ctrl+Shift+S'", () => {
			expect(formatKbd('⌘⇧S')).toBe('Ctrl+Shift+S');
		});

		it("converts '⌥⌘I' to 'Alt+Ctrl+I' without a double plus sign", () => {
			const result = formatKbd('⌥⌘I');
			expect(result).toBe('Alt+Ctrl+I');
			expect(result).not.toContain('++');
		});

		it("converts '⌘F' to 'Ctrl+F'", () => {
			expect(formatKbd('⌘F')).toBe('Ctrl+F');
		});
	});
});
