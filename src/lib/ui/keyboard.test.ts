import { beforeEach, describe, expect, it, vi } from 'vitest';
import { keyboardStore, isReservedShortcut } from './keyboard.svelte';

beforeEach(() => {
	localStorage.clear();
	keyboardStore.overrides = {};
});

describe('personnalisation des raccourcis', () => {
	it('persiste et recharge un raccourci valide, puis le réinitialise', () => {
		expect(keyboardStore.set('palette', { key: ';', shift: false })).toBeNull();
		expect(keyboardStore.label('palette')).toContain(';');
		keyboardStore.overrides = {};
		keyboardStore.load();
		expect(keyboardStore.binding('palette')).toEqual({ key: ';', shift: false });
		expect(keyboardStore.reset()).toBeNull();
		expect(keyboardStore.binding('palette')).toEqual({ key: 'p', shift: true });
	});
	it('refuse doublons, combinaisons réservées et valeurs invalides', () => {
		expect(keyboardStore.set('palette', { key: 'f', shift: true })).toBe('duplicate');
		expect(keyboardStore.set('palette', { key: 'p', shift: true })).toBe('reserved');
		expect(keyboardStore.set('palette', { key: 'Escape', shift: false })).toBe('invalid');
		expect(keyboardStore.set('unknown', null)).toBe('invalid');
	});
	it('ignore les préférences corrompues et les commandes inconnues', () => {
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
	it('désactive une commande et annonce les changements', () => {
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
	it('distingue les réservations web et desktop', () => {
		expect(isReservedShortcut({ key: 'p', shift: true }, false)).toBe(true);
		expect(isReservedShortcut({ key: 'p', shift: true }, true)).toBe(false);
		expect(isReservedShortcut({ key: 'c', shift: false }, true)).toBe(true);
	});
	it('conserve la configuration si le stockage échoue', () => {
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
