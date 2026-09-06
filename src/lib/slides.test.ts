import { describe, it, expect } from 'vitest';
import { splitSlides } from './slides';

describe('splitSlides', () => {
	it('returns one slide when the document has no separator', () => {
		expect(splitSlides('# Titre\n\ncorps')).toEqual(['# Titre\n\ncorps']);
	});

	it('splits at horizontal rules', () => {
		const md = '# Slide 1\n\n---\n\n# Slide 2\n\n---\n\n# Slide 3';
		expect(splitSlides(md)).toEqual(['# Slide 1', '# Slide 2', '# Slide 3']);
	});

	it('does not create an empty slide from front matter', () => {
		const md = '---\ntitle: Deck\n---\n\n# Slide 1\n\n---\n\n# Slide 2';
		expect(splitSlides(md)).toEqual(['# Slide 1', '# Slide 2']);
	});

	it('removes empty slides between consecutive separators', () => {
		const md = '# A\n\n---\n\n---\n\n# B';
		expect(splitSlides(md)).toEqual(['# A', '# B']);
	});

	it('accepts separators with more than three hyphens', () => {
		expect(splitSlides('A\n-----\nB')).toEqual(['A', 'B']);
	});

	it('returns no slides for an empty document', () => {
		expect(splitSlides('')).toEqual([]);
		expect(splitSlides('   \n  ')).toEqual([]);
	});

	it('does not split at a rule inside a fenced code block', () => {
		const md = 'Slide 1\n\n```\n---\n```\n\n---\n\nSlide 2';
		// Keep `---` inside the fence on slide 1. Only `---` outside the fence splits slides.
		expect(splitSlides(md)).toEqual(['Slide 1\n\n```\n---\n```', 'Slide 2']);
	});

	it('supports tilde fences and ignores a different closing marker', () => {
		const md = 'A\n\n~~~\n---\n~~~\n\n---\n\nB';
		expect(splitSlides(md)).toEqual(['A\n\n~~~\n---\n~~~', 'B']);
	});
});
