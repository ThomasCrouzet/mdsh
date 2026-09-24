import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isMac, formatKbd } from './platform';

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
	it('uses userAgent when platform is empty', () => {
		setNavPlatform('', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/537.36');
		expect(isMac()).toBe(true);
	});
});

describe('formatKbd on Windows and Linux', () => {
	beforeEach(() => setNavPlatform('Win32'));

	it("converts '⌘⇧P' to 'Ctrl+Shift+P'", () => {
		expect(formatKbd('⌘⇧P')).toBe('Ctrl+Shift+P');
	});
});
