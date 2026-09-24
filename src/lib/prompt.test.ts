import { describe, it, expect, beforeEach } from 'vitest';
import { promptStore } from './prompt.svelte';

beforeEach(() => {
	promptStore.resolve(null);
});

describe('promptStore.prompt', () => {
	it('cancels the previous prompt when a new prompt opens', async () => {
		const p1 = promptStore.prompt({ title: 'First' });
		const p2 = promptStore.prompt({ title: 'Second' });
		expect(await p1).toBeNull();
		expect(promptStore.config?.title).toBe('Second');
		promptStore.resolve('done');
		expect(await p2).toBe('done');
	});
});
