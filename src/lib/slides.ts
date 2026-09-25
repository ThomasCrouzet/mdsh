// §2.10 - Splitting a markdown document into slides (pure, testable logic).
//
// Convention: a horizontal rule `---` (>= 3 hyphens) alone on its line
// separates two slides. Any front-matter (also delimited by `---`) is removed
// BEFORE the split so as not to create a fake empty first slide.

import { stripFrontmatter } from './frontmatter';

const SLIDE_SEPARATOR = /^\s*-{3,}\s*$/;

/**
 * Splits the markdown into slides. Returns at least one slide if the content is
 * non-empty; empty slides (consecutive separators) are filtered out. A document
 * with no separator yields a single slide.
 */
export function splitSlides(markdown: string): string[] {
	const body = stripFrontmatter(markdown).content;
	const slides: string[] = [];
	let current: string[] = [];
	// Tracks the "inside a fenced code block" state (``` or ~~~) so as NOT to
	// split on a `---` located inside a fence (otherwise the block was scattered
	// across several slides with orphan ```, and the content lost).
	let marker = '';
	for (const line of body.split('\n')) {
		const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
		if (fence) {
			const next = fence[1]!;
			if (!marker) marker = next;
			else if (next[0] === marker[0] && next.length >= marker.length && line.trim() === next)
				marker = '';
			current.push(line);
			continue;
		}
		if (!marker && SLIDE_SEPARATOR.test(line)) {
			slides.push(current.join('\n').trim());
			current = [];
		} else {
			current.push(line);
		}
	}
	slides.push(current.join('\n').trim());
	return slides.filter((s) => s.length > 0);
}
