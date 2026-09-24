import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from './db';
import { templatesStore } from './templates.svelte';

beforeEach(async () => {
	await db.templates.clear();
	templatesStore.userTemplates = [];
	templatesStore.loaded = false;
});
afterEach(async () => {
	vi.restoreAllMocks();
	await db.templates.clear();
});

describe('templatesStore', () => {
	it('updates a template only after its new content is durable', async () => {
		const template = await templatesStore.save('Before', 'old');
		expect(await templatesStore.update(template!.id, 'After', 'new')).toBe(true);
		expect(await db.templates.get(template!.id)).toMatchObject({ name: 'After', content: 'new' });
		vi.spyOn(db.templates, 'put').mockRejectedValueOnce(new Error('Full'));
		expect(await templatesStore.update(template!.id, 'Lost', 'lost')).toBe(false);
		expect(templatesStore.userTemplates[0]).toMatchObject({ name: 'After', content: 'new' });
		expect(await templatesStore.update('missing', 'Name', '')).toBe(false);
	});
});
