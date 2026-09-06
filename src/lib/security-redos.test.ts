// §J2 - Protect regular expression parsers from ReDoS with hostile content.
//
// The app parses imported Markdown from drops, shares, launch events, and disk.
// Some expressions combine reluctant quantifiers and alternatives. A hostile file
// can cause catastrophic backtracking and block the browser tab.
//
// Use two test levels:
//   1. Deterministic regression uses known pathological input and a one-second limit.
//      Catastrophic backtracking takes many seconds. Linear parsing stays below 1 ms
//      for 100,000 characters, so the limit separates these cases in CI.
//   2. fast-check creates metacharacter strings that stress the parsers.
//      Catastrophic backtracking exceeds the test timeout and causes a clear failure.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { slugify, preprocessWikiLinks, extractWikiLinkTargets } from './wiki-links';
import { stripFrontmatter } from './frontmatter';
import { hasMath, hasMermaid, renderMarkdown } from './render/markdown';

function elapsed(fn: () => void): number {
	const t0 = performance.now();
	fn();
	return performance.now() - t0;
}

describe('anti-ReDoS - pathological input regression', () => {
	// Candidate 1: the math tokenizer combines `\\$|[^\n$]` with a reluctant quantifier.
	it('hasMath handles an unterminated backslash sequence', () => {
		expect(elapsed(() => hasMath('$' + '\\'.repeat(100_000)))).toBeLessThan(1000);
	});
	it('hasMath handles a large unclosed dollar sequence', () => {
		expect(elapsed(() => hasMath('$' + 'a'.repeat(100_000)))).toBeLessThan(1000);
	});
	it('hasMath handles alternating partial dollar markers', () => {
		expect(elapsed(() => hasMath('$a'.repeat(50_000)))).toBeLessThan(1000);
	});
	it('hasMermaid handles repeated fences', () => {
		expect(elapsed(() => hasMermaid('```'.repeat(50_000)))).toBeLessThan(1000);
	});
	it('preprocessWikiLinks handles repeated opening brackets', () => {
		expect(elapsed(() => preprocessWikiLinks('[['.repeat(50_000)))).toBeLessThan(1000);
	});
	it('preprocessWikiLinks handles a large unclosed target', () => {
		expect(elapsed(() => preprocessWikiLinks('[[' + 'a'.repeat(100_000)))).toBeLessThan(1000);
	});
	it('extractWikiLinkTargets handles mixed pipes and brackets', () => {
		expect(elapsed(() => extractWikiLinkTargets('[[a|'.repeat(50_000)))).toBeLessThan(1000);
	});
	it('stripFrontmatter handles an unclosed front matter block', () => {
		expect(elapsed(() => stripFrontmatter('---\n' + 'a\n'.repeat(100_000)))).toBeLessThan(1000);
	});
	it('slugify handles large input with diacritics', () => {
		expect(elapsed(() => slugify('Éà-'.repeat(100_000)))).toBeLessThan(1000);
	});
});

describe('anti-ReDoS - metacharacter fuzzing', () => {
	// Build strings from delimiters that stress math, wiki, and front matter parsers.
	const meta = fc
		.array(fc.constantFrom('$', '\\', '[', ']', '|', '-', '`', '\n', 'x'), { maxLength: 1500 })
		.map((chars) => chars.join(''));

	it('keeps all parsers stable with hostile input', { timeout: 10_000 }, () => {
		fc.assert(
			fc.property(meta, (s) => {
				// Catastrophic backtracking exceeds the timeout above.
				hasMath(s);
				hasMermaid(s);
				preprocessWikiLinks(s);
				extractWikiLinkTargets(s);
				stripFrontmatter(s);
				slugify(s);
				return true;
			}),
			{ numRuns: 400 }
		);
	});

	it('keeps slugify output in [a-z0-9-] without edge hyphens', () => {
		fc.assert(
			fc.property(fc.string(), (s) => {
				const out = slugify(s);
				return /^[a-z0-9-]*$/.test(out) && !out.startsWith('-') && !out.endsWith('-');
			}),
			{ numRuns: 500 }
		);
	});

	it('keeps text unchanged without wiki link markers', () => {
		fc.assert(
			fc.property(
				fc.string().filter((s) => !s.includes('[[')),
				(s) => preprocessWikiLinks(s) === s
			),
			{ numRuns: 300 }
		);
	});
});

describe('§J2 - YAML alias bomb in front matter', () => {
	// A YAML alias bomb creates a compact shared graph. Stringifying it as a tree grows exponentially.
	// buildFrontmatterBlock must never expand this front-matter graph.
	it('renders bounded output in less than one second', async () => {
		const md = [
			'---',
			'a: &a [x,x,x,x,x,x,x,x,x]',
			'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]',
			'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]',
			'd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c]',
			'e: &e [*d,*d,*d,*d,*d,*d,*d,*d,*d]',
			'f: &f [*e,*e,*e,*e,*e,*e,*e,*e,*e]',
			'g: [*f,*f,*f,*f,*f,*f,*f,*f,*f]',
			'---',
			'# Titre'
		].join('\n');
		const t0 = performance.now();
		const html = await renderMarkdown(md);
		const ms = performance.now() - t0;
		// Without a limit, String() would traverse about 9^6 nodes and create several megabytes of output.
		expect(ms).toBeLessThan(1000);
		expect(html.length).toBeLessThan(50_000);
	});
});
