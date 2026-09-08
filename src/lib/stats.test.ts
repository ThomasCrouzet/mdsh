import { describe, it, expect, beforeAll } from 'vitest';
import { computeStats, formatSaveAge } from './stats';
import { i18n } from '$lib/i18n';

describe('computeStats', () => {
	it('returns zero counts for empty text', () => {
		const s = computeStats('');
		expect(s.words).toBe(0);
		expect(s.chars).toBe(0);
		expect(s.lines).toBe(0);
		expect(s.readMinutes).toBe(0);
	});

	it('counts words and characters', () => {
		const s = computeStats('Bonjour le monde');
		expect(s.words).toBe(3);
		expect(s.chars).toBe(16);
		expect(s.lines).toBe(1);
	});

	it('ignores inline code markers', () => {
		const s = computeStats('Voir `npm run dev` pour lancer');
		expect(s.words).toBe(3);
	});

	it('removes Markdown heading markers', () => {
		const s = computeStats('# Titre\n\nUn paragraphe ici.');
		expect(s.words).toBe(4);
	});

	it('ignores code blocks', () => {
		const s = computeStats('Avant\n```\nconst x = 1\nconst y = 2\n```\nAprès');
		expect(s.words).toBe(2);
	});

	it('returns a minimum reading time of one minute', () => {
		const s = computeStats('un mot');
		expect(s.readMinutes).toBeGreaterThanOrEqual(1);
	});
});

describe('formatSaveAge', () => {
	// The labels use i18n. Select the French locale for the exact string checks.
	beforeAll(() => {
		i18n.set('fr');
	});

	it('returns the unsaved label for zero', () => {
		expect(formatSaveAge(0)).toBe('non enregistré');
	});

	it('returns the saved label before two seconds', () => {
		const now = Date.now();
		expect(formatSaveAge(now, now)).toBe('enregistré');
	});

	it('formats seconds', () => {
		const now = Date.now();
		expect(formatSaveAge(now - 5000, now)).toBe('enregistré il y a 5s');
	});

	it('formats minutes', () => {
		const now = Date.now();
		expect(formatSaveAge(now - 180_000, now)).toBe('enregistré il y a 3min');
	});

	it('formats hours', () => {
		const now = Date.now();
		expect(formatSaveAge(now - 7_200_000, now)).toBe('enregistré il y a 2h');
	});
});
