import { describe, it, expect, beforeAll } from 'vitest';
import { computeStats, formatSaveAge } from './stats';
import { i18n } from '$lib/i18n';

describe('computeStats', () => {
	it('compte zéro sur un texte vide', () => {
		const s = computeStats('');
		expect(s.words).toBe(0);
		expect(s.chars).toBe(0);
		expect(s.lines).toBe(0);
	});

	it('compte les mots et caractères', () => {
		const s = computeStats('Bonjour le monde');
		expect(s.words).toBe(3);
		expect(s.chars).toBe(16);
		expect(s.lines).toBe(1);
	});

	it('ignore les backticks de code', () => {
		const s = computeStats('Voir `npm run dev` pour lancer');
		expect(s.words).toBe(3);
	});

	it('strip les titres markdown', () => {
		const s = computeStats('# Titre\n\nUn paragraphe ici.');
		expect(s.words).toBe(4);
	});

	it('ignore les blocs de code', () => {
		const s = computeStats('Avant\n```\nconst x = 1\nconst y = 2\n```\nAprès');
		expect(s.words).toBe(2);
	});

	it('donne au moins 1 min de lecture', () => {
		const s = computeStats('un mot');
		expect(s.readMinutes).toBeGreaterThanOrEqual(1);
	});
});

describe('formatSaveAge', () => {
	// Les libellés migrés passent par i18n - on fixe la locale française pour
	// asserter les chaînes verbatim ci-dessous.
	beforeAll(() => {
		i18n.set('fr');
	});

	it('retourne non enregistré si 0', () => {
		expect(formatSaveAge(0)).toBe('non enregistré');
	});

	it('dit enregistré si < 2s', () => {
		const now = Date.now();
		expect(formatSaveAge(now, now)).toBe('enregistré');
	});

	it('formatte en secondes', () => {
		const now = Date.now();
		expect(formatSaveAge(now - 5000, now)).toBe('enregistré il y a 5s');
	});

	it('formatte en minutes', () => {
		const now = Date.now();
		expect(formatSaveAge(now - 180_000, now)).toBe('enregistré il y a 3min');
	});

	it('formatte en heures', () => {
		const now = Date.now();
		expect(formatSaveAge(now - 7_200_000, now)).toBe('enregistré il y a 2h');
	});
});
