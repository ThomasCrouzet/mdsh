import { beforeEach, describe, expect, it, vi } from 'vitest';
import { keyboardStore, isReservedShortcut } from './keyboard.svelte';

beforeEach(() => {
	localStorage.clear();
	keyboardStore.overrides = {};
});

describe('shortcut customization', () => {
	it('persists, reloads, and resets a valid shortcut', () => {
		expect(keyboardStore.set('palette', { key: ';', shift: false })).toBeNull();
		expect(keyboardStore.label('palette')).toContain(';');
		keyboardStore.overrides = {};
		keyboardStore.load();
		expect(keyboardStore.binding('palette')).toEqual({ key: ';', shift: false });
		expect(keyboardStore.reset()).toBeNull();
		expect(keyboardStore.binding('palette')).toEqual({ key: 'p', shift: true });
	});
	it('rejects duplicates, reserved combinations, and invalid values', () => {
		expect(keyboardStore.set('palette', { key: 'f', shift: true })).toBe('duplicate');
		expect(keyboardStore.set('palette', { key: 'p', shift: true })).toBe('reserved');
		expect(keyboardStore.set('palette', { key: 'Escape', shift: false })).toBe('invalid');
		expect(keyboardStore.set('unknown', null)).toBe('invalid');
	});
	it('ignores invalid preferences and unknown commands', () => {
		localStorage.setItem(
			keyboardStore.storageKey,
			JSON.stringify({
				unknown: null,
				palette: { key: 'p', shift: true },
				new: { key: 'g', shift: 'no' }
			})
		);
		keyboardStore.load();
		expect(keyboardStore.overrides).toEqual({});
	});
	it('disables a command and reports changes', () => {
		const listener = vi.fn();
		window.addEventListener('mdsh:shortcuts-change', listener);
		try {
			expect(keyboardStore.set('palette', null)).toBeNull();
			expect(keyboardStore.binding('palette')).toBeNull();
			expect(listener).toHaveBeenCalledOnce();
		} finally {
			window.removeEventListener('mdsh:shortcuts-change', listener);
		}
	});
	it('separates web and desktop reservations', () => {
		expect(isReservedShortcut({ key: 'p', shift: true }, false)).toBe(true);
		expect(isReservedShortcut({ key: 'p', shift: true }, true)).toBe(false);
		expect(isReservedShortcut({ key: 'c', shift: false }, true)).toBe(true);
	});
	it('keeps the configuration after a storage failure', () => {
		const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
			throw new Error('quota');
		});
		try {
			expect(keyboardStore.set('palette', { key: ';', shift: false })).toBe('storage');
			expect(keyboardStore.binding('palette')?.key).toBe('p');
		} finally {
			setItem.mockRestore();
		}
	});
});
