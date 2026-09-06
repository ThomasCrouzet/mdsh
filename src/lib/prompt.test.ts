import { describe, it, expect, beforeEach } from 'vitest';
import { promptStore } from './prompt.svelte';

beforeEach(() => {
	// Reset any pending modal between tests.
	promptStore.resolve(null);
});

describe('promptStore.prompt', () => {
	it('opens a prompt and resolves with the entered value', async () => {
		const p = promptStore.prompt({ title: 'Name?' });
		expect(promptStore.open).toBe(true);
		expect(promptStore.config?.mode).toBe('prompt');
		promptStore.resolve('hello');
		expect(await p).toBe('hello');
		expect(promptStore.open).toBe(false);
		expect(promptStore.config).toBeNull();
	});

	it('resolves with null after cancellation', async () => {
		const p = promptStore.prompt({ title: 'Name?' });
		promptStore.resolve(null);
		expect(await p).toBeNull();
	});

	it('cancels the previous prompt when a new prompt opens', async () => {
		const p1 = promptStore.prompt({ title: 'First' });
		const p2 = promptStore.prompt({ title: 'Second' });
		expect(await p1).toBeNull(); // annulé par le 2e
		expect(promptStore.config?.title).toBe('Second');
		promptStore.resolve('done');
		expect(await p2).toBe('done');
	});
});

describe('promptStore.confirm', () => {
	it('resolves true after confirmation and false after cancellation', async () => {
		const yes = promptStore.confirm({ title: 'Sure?' });
		expect(promptStore.config?.mode).toBe('confirm');
		promptStore.resolve(true);
		expect(await yes).toBe(true);

		const no = promptStore.confirm({ title: 'Sure?' });
		promptStore.resolve(false);
		expect(await no).toBe(false);

		const cancelled = promptStore.confirm({ title: 'Sure?' });
		promptStore.resolve(null);
		expect(await cancelled).toBe(false);
	});
});

describe('promptStore.resolve', () => {
	it('does nothing without a pending modal', () => {
		expect(() => promptStore.resolve('x')).not.toThrow();
		expect(promptStore.open).toBe(false);
	});
});

describe('explicit restore choice', () => {
	it.each(['primary', 'alternate', null] as const)(
		'préserve le résultat %s sans transformer une annulation',
		async (choice) => {
			const pending = promptStore.choose({ title: 'Restaurer', alternateLabel: 'Fusionner' });
			promptStore.resolve(choice);
			expect(await pending).toBe(choice);
		}
	);
});
