import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from './db';
import { templatesStore } from './templates.svelte';
import { BUILTIN_TEMPLATES } from './templates';

beforeEach(async () => {
	await db.templates.clear();
	templatesStore.userTemplates = [];
	templatesStore.loaded = false;
});
afterEach(async () => {
	await db.templates.clear();
});

describe('templatesStore', () => {
	it('loads the latest user templates first', async () => {
		await db.templates.bulkPut([
			{ id: 'a', name: 'A', content: 'x', builtin: false, createdAt: 1, updatedAt: 1 },
			{ id: 'b', name: 'B', content: 'y', builtin: false, createdAt: 2, updatedAt: 2 }
		]);
		await templatesStore.load();
		expect(templatesStore.userTemplates.map((t) => t.id)).toEqual(['b', 'a']);
	});

	it('does not load again when loaded is true', async () => {
		await templatesStore.load();
		await db.templates.put({
			id: 'late',
			name: 'L',
			content: '',
			builtin: false,
			createdAt: 9,
			updatedAt: 9
		});
		await templatesStore.load(); // déjà loaded -> no-op
		expect(templatesStore.userTemplates.some((t) => t.id === 'late')).toBe(false);
	});

	it('lists built-in templates before user templates with the correct flag', async () => {
		await templatesStore.save('Perso', '# Perso');
		const choices = templatesStore.choices;
		expect(choices.length).toBe(BUILTIN_TEMPLATES.length + 1);
		expect(choices.slice(0, BUILTIN_TEMPLATES.length).every((c) => c.builtin)).toBe(true);
		expect(choices.at(-1)).toMatchObject({ name: 'Perso', builtin: false });
	});

	it('persists and returns a saved row at the start of the list', async () => {
		const row = await templatesStore.save('Mon modèle', '# Contenu');
		expect(row).not.toBeNull();
		// Svelte 5 $state arrays proxy their elements. Compare IDs instead of object references.
		expect(templatesStore.userTemplates[0]?.id).toBe(row!.id);
		expect(await db.templates.get(row!.id)).toMatchObject({ name: 'Mon modèle' });
	});

	it('uses a non-empty fallback for an empty name', async () => {
		const row = await templatesStore.save('   ', 'x');
		expect(row).not.toBeNull();
		expect(row!.name.trim().length).toBeGreaterThan(0);
	});

	it('deletes a user template from the list and database', async () => {
		const row = await templatesStore.save('X', 'x');
		await templatesStore.delete(row!.id);
		expect(templatesStore.userTemplates.find((t) => t.id === row!.id)).toBeUndefined();
		expect(await db.templates.get(row!.id)).toBeUndefined();
	});

	it('does not delete a protected built-in ID', async () => {
		await templatesStore.save('Y', 'y');
		const before = templatesStore.userTemplates.length;
		await templatesStore.delete('builtin:daily');
		expect(templatesStore.userTemplates.length).toBe(before);
	});

	it('returns name and content for a built-in template', () => {
		const b = BUILTIN_TEMPLATES[0]!;
		const r = templatesStore.resolve(b.id, new Date('2026-01-15T10:00:00Z'));
		expect(r).not.toBeNull();
		expect(r!.name.length).toBeGreaterThan(0);
		expect(typeof r!.content).toBe('string');
	});

	it('returns a Markdown name and content for a user template', async () => {
		const row = await templatesStore.save('Notes', '# Titre');
		const r = templatesStore.resolve(row!.id, new Date('2026-01-15T10:00:00Z'));
		expect(r!.name).toBe('Notes.md');
		expect(typeof r!.content).toBe('string');
	});

	it('returns null for an unknown ID', () => {
		expect(templatesStore.resolve('inconnu')).toBeNull();
	});

	it('loads from Dexie again after reload', async () => {
		await templatesStore.load();
		await db.templates.put({
			id: 'z',
			name: 'Z',
			content: 'z',
			builtin: false,
			createdAt: 3,
			updatedAt: 3
		});
		await templatesStore.reload();
		expect(templatesStore.userTemplates.some((t) => t.id === 'z')).toBe(true);
	});
});
