import { describe, it, expect, afterEach, vi } from 'vitest';
import { isDesktop } from './desktop';

afterEach(() => {
	vi.unstubAllGlobals();
	// Restore any TAURI flag we may have set on window.
	const w = window as Window & { __TAURI_INTERNALS__?: unknown; isTauri?: boolean };
	delete w.__TAURI_INTERNALS__;
	delete w.isTauri;
});

describe('isDesktop', () => {
	it('returns false in a plain browser (jsdom)', () => {
		expect(isDesktop()).toBe(false);
	});

	it('returns true when window.isTauri is set', () => {
		(window as Window & { isTauri?: boolean }).isTauri = true;
		expect(isDesktop()).toBe(true);
	});

	it('returns true when __TAURI_INTERNALS__ is present', () => {
		(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
		expect(isDesktop()).toBe(true);
	});
});
