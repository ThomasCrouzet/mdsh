import { describe, it, expect } from 'vitest';
import { computeStats } from './stats';

describe('computeStats', () => {
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
});
