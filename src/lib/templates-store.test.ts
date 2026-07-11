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
	it('load : lit les modèles utilisateur, plus récents en tête', async () => {
		await db.templates.bulkPut([
			{ id: 'a', name: 'A', content: 'x', builtin: false, createdAt: 1, updatedAt: 1 },
			{ id: 'b', name: 'B', content: 'y', builtin: false, createdAt: 2, updatedAt: 2 }
		]);
		await templatesStore.load();
		expect(templatesStore.userTemplates.map((t) => t.id)).toEqual(['b', 'a']);
	});

	it('load : idempotent (loaded=true coupe la relecture)', async () => {
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

	it('choices : builtins d’abord puis modèles utilisateur, flag builtin correct', async () => {
		await templatesStore.save('Perso', '# Perso');
		const choices = templatesStore.choices;
		expect(choices.length).toBe(BUILTIN_TEMPLATES.length + 1);
		expect(choices.slice(0, BUILTIN_TEMPLATES.length).every((c) => c.builtin)).toBe(true);
		expect(choices.at(-1)).toMatchObject({ name: 'Perso', builtin: false });
	});

	it('save : persiste, retourne la row et l’ajoute en tête', async () => {
		const row = await templatesStore.save('Mon modèle', '# Contenu');
		expect(row).not.toBeNull();
		// Note : les tableaux $state de Svelte 5 proxient leurs éléments, donc on
		// compare par id (pas d'égalité de référence avec l'objet retourné).
		expect(templatesStore.userTemplates[0]?.id).toBe(row!.id);
		expect(await db.templates.get(row!.id)).toMatchObject({ name: 'Mon modèle' });
	});

	it('save : nom vide -> nom de repli non vide', async () => {
		const row = await templatesStore.save('   ', 'x');
		expect(row).not.toBeNull();
		expect(row!.name.trim().length).toBeGreaterThan(0);
	});

	it('delete : retire un modèle utilisateur de la liste et de la base', async () => {
		const row = await templatesStore.save('X', 'x');
		await templatesStore.delete(row!.id);
		expect(templatesStore.userTemplates.find((t) => t.id === row!.id)).toBeUndefined();
		expect(await db.templates.get(row!.id)).toBeUndefined();
	});

	it('delete : no-op sur un id builtin: (protégé)', async () => {
		await templatesStore.save('Y', 'y');
		const before = templatesStore.userTemplates.length;
		await templatesStore.delete('builtin:daily');
		expect(templatesStore.userTemplates.length).toBe(before);
	});

	it('resolve : un builtin renvoie name + content', () => {
		const b = BUILTIN_TEMPLATES[0]!;
		const r = templatesStore.resolve(b.id, new Date('2026-01-15T10:00:00Z'));
		expect(r).not.toBeNull();
		expect(r!.name.length).toBeGreaterThan(0);
		expect(typeof r!.content).toBe('string');
	});

	it('resolve : un modèle utilisateur renvoie {name}.md + content', async () => {
		const row = await templatesStore.save('Notes', '# Titre');
		const r = templatesStore.resolve(row!.id, new Date('2026-01-15T10:00:00Z'));
		expect(r!.name).toBe('Notes.md');
		expect(typeof r!.content).toBe('string');
	});

	it('resolve : id inconnu -> null', () => {
		expect(templatesStore.resolve('inconnu')).toBeNull();
	});

	it('reload : force une relecture depuis Dexie', async () => {
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
