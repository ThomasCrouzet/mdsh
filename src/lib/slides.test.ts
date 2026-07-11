import { describe, it, expect } from 'vitest';
import { splitSlides } from './slides';

describe('splitSlides', () => {
	it('document sans séparateur → une seule diapo', () => {
		expect(splitSlides('# Titre\n\ncorps')).toEqual(['# Titre\n\ncorps']);
	});

	it('découpe sur les règles horizontales ---', () => {
		const md = '# Slide 1\n\n---\n\n# Slide 2\n\n---\n\n# Slide 3';
		expect(splitSlides(md)).toEqual(['# Slide 1', '# Slide 2', '# Slide 3']);
	});

	it('ignore le front-matter (pas de fausse diapo vide)', () => {
		const md = '---\ntitle: Deck\n---\n\n# Slide 1\n\n---\n\n# Slide 2';
		expect(splitSlides(md)).toEqual(['# Slide 1', '# Slide 2']);
	});

	it('filtre les diapos vides (séparateurs consécutifs)', () => {
		const md = '# A\n\n---\n\n---\n\n# B';
		expect(splitSlides(md)).toEqual(['# A', '# B']);
	});

	it('accepte les séparateurs de plus de 3 tirets', () => {
		expect(splitSlides('A\n-----\nB')).toEqual(['A', 'B']);
	});

	it('document vide → aucune diapo', () => {
		expect(splitSlides('')).toEqual([]);
		expect(splitSlides('   \n  ')).toEqual([]);
	});

	it('ne coupe PAS sur un --- à l’intérieur d’un bloc de code clôturé', () => {
		const md = 'Slide 1\n\n```\n---\n```\n\n---\n\nSlide 2';
		// Le `---` du fence reste dans la diapo 1 ; seul le `---` hors fence coupe.
		expect(splitSlides(md)).toEqual(['Slide 1\n\n```\n---\n```', 'Slide 2']);
	});

	it('gère les fences ~~~ et ne se ferme pas sur un marqueur d’un autre type', () => {
		const md = 'A\n\n~~~\n---\n~~~\n\n---\n\nB';
		expect(splitSlides(md)).toEqual(['A\n\n~~~\n---\n~~~', 'B']);
	});
});
