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
	let inFence = false;
	let fenceChar = '';
	for (const line of body.split('\n')) {
		const fence = /^\s*(`{3,}|~{3,})/.exec(line);
		if (fence) {
			const char = fence[1]![0]!; // ` or ~
			if (!inFence) {
				inFence = true;
				fenceChar = char;
			} else if (char === fenceChar) {
				inFence = false;
				fenceChar = '';
			}
			current.push(line);
			continue;
		}
		if (!inFence && SLIDE_SEPARATOR.test(line)) {
			slides.push(current.join('\n').trim());
			current = [];
		} else {
			current.push(line);
		}
	}
	slides.push(current.join('\n').trim());
	return slides.filter((s) => s.length > 0);
}
