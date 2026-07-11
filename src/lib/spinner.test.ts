import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spinnerStore } from './spinner.svelte';

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.runOnlyPendingTimers();
	vi.useRealTimers();
});

describe('spinnerStore', () => {
	it("ne s'affiche qu'après 200 ms; dismiss masque", () => {
		const dismiss = spinnerStore.show('Export...');
		expect(spinnerStore.visible).toBe(false); // délai non écoulé
		vi.advanceTimersByTime(200);
		expect(spinnerStore.visible).toBe(true);
		expect(spinnerStore.message).toBe('Export...');
		dismiss();
		expect(spinnerStore.visible).toBe(false);
	});

	it("dismiss avant 200 ms annule l'affichage (pas de flash)", () => {
		const dismiss = spinnerStore.show('Quick');
		dismiss();
		vi.advanceTimersByTime(300);
		expect(spinnerStore.visible).toBe(false);
	});

	it("ref-counting : reste visible tant qu'un export tourne", () => {
		const d1 = spinnerStore.show('A');
		const d2 = spinnerStore.show('B');
		vi.advanceTimersByTime(200);
		expect(spinnerStore.visible).toBe(true);
		expect(spinnerStore.message).toBe('B'); // le plus récent
		d1(); // A terminé, B encore en cours
		expect(spinnerStore.visible).toBe(true);
		d2();
		expect(spinnerStore.visible).toBe(false);
	});
});
