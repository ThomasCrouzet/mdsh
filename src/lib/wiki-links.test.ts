import { describe, it, expect } from 'vitest';
import {
	slugify,
	escapeRegex,
	preprocessWikiLinks,
	decodeWikiTarget,
	extractWikiLinkTargets,
	rewriteWikiLinkTargets
} from './wiki-links';

describe('target rewriting', () => {
	it('keeps nested list links and protects indented code inside list items', () => {
		const md = '- Parent\n    - [[old]]\n\n          [[code]]\n\n    [[old|Label]]\n';
		expect(extractWikiLinkTargets(md)).toEqual(['old']);
		expect(rewriteWikiLinkTargets(md, (target) => (target === 'old' ? 'new' : target))).toBe(
			'- Parent\n    - [[new]]\n\n          [[code]]\n\n    [[new|Label]]\n'
		);
	});
	it('supports inline triple backticks at the start of a paragraph', () => {
		expect(extractWikiLinkTargets('```[[code]]``` and [[real]]')).toEqual(['real']);
	});
	it('keeps code, escaped links, YAML, aliases, and whitespace intact', () => {
		const code =
			'---\ntitle: "[[old]]"\n---\n`[[old]]` ``code ` [[old]]``\n\n    [[old]]\n\\[[old]]\n~~~~\n[[old]]\n~~~~\n';
		expect(
			rewriteWikiLinkTargets(code + '[[ old |Alias]] [[other]]', (target) =>
				target === 'old' ? 'new' : target
			)
		).toBe(code + '[[ new |Alias]] [[other]]');
		expect(extractWikiLinkTargets(code + '[[old|label]]')).toEqual(['old']);
		expect(preprocessWikiLinks(code)).toBe(code);
	});
	it('leaves unclosed fences intact and accepts literal unmatched backticks', () => {
		expect(rewriteWikiLinkTargets('` text [[old]]\n```\n[[old]]', () => 'new')).toBe(
			'` text [[new]]\n```\n[[old]]'
		);
	});
});

describe('slugify', () => {
	it('removes diacritics', () => {
		expect(slugify('Café')).toBe('cafe');
	});

	it('removes combined diacritics', () => {
		expect(slugify('àüñ')).toBe('aun');
	});

	it('converts text to lowercase', () => {
		expect(slugify('Hello World')).toBe('hello-world');
	});

	it('replaces spaces with hyphens', () => {
		expect(slugify('mon fichier notes')).toBe('mon-fichier-notes');
	});

	it('groups non-alphanumeric characters into one hyphen', () => {
		expect(slugify('a  b--c')).toBe('a-b-c');
	});

	it('removes leading and trailing hyphens', () => {
		expect(slugify('  Titre!  ')).toBe('titre');
	});

	it('returns an empty string for empty input', () => {
		expect(slugify('')).toBe('');
	});

	it('returns an empty string for separator-only input', () => {
		expect(slugify('---')).toBe('');
	});

	it('keeps digits', () => {
		expect(slugify('Note 42')).toBe('note-42');
	});

	it('supports a title with hyphens and composed uppercase characters', () => {
		expect(slugify('Réunion RH - 2026')).toBe('reunion-rh-2026');
	});
});

describe('escapeRegex', () => {
	it('escapes the dot regular expression metacharacter', () => {
		expect(escapeRegex('a.b')).toBe('a\\.b');
	});

	it('escapes the asterisk', () => {
		expect(escapeRegex('a*b')).toBe('a\\*b');
	});

	it('escapes common regular expression metacharacters', () => {
		const input = '.*+?^${}()|[]\\';
		const escaped = escapeRegex(input);
		// Prefix each metacharacter with a backslash. Verify that none remains bare.
		expect(() => new RegExp(escaped)).not.toThrow();
		// The escaped regular expression must match the original text exactly.
		expect(new RegExp(escaped).test(input)).toBe(true);
	});

	it('keeps ordinary characters unchanged', () => {
		expect(escapeRegex('hello world')).toBe('hello world');
	});

	it('returns an empty string for empty input', () => {
		expect(escapeRegex('')).toBe('');
	});
});

describe('preprocessWikiLinks', () => {
	it('transforms [[X]] into an anchor with the wiki-link class', () => {
		const result = preprocessWikiLinks('Voir [[Notes]]');
		expect(result).toContain('class="wiki-link"');
		expect(result).toContain('href="#mdsh-wiki-notes"');
		expect(result).toContain('>Notes<');
	});

	it('uses the alias from [[X|alias]]', () => {
		const result = preprocessWikiLinks('[[Rapport annuel|Rapport]]');
		expect(result).toContain('>Rapport<');
		expect(result).toContain('href="#mdsh-wiki-rapport-annuel"');
	});

	it('encodes the target in data-mdsh-wiki with encodeURIComponent', () => {
		const result = preprocessWikiLinks('[[Mon fichier.md]]');
		expect(result).toContain('data-mdsh-wiki="Mon%20fichier.md"');
	});

	it('escapes unsafe HTML characters in the label', () => {
		const result = preprocessWikiLinks('[[<script>alert(1)</script>]]');
		expect(result).not.toContain('<script>');
		// The label must be escaped.
		expect(result).toContain('&lt;script&gt;');
	});

	it('escapes HTML characters in the alias', () => {
		const result = preprocessWikiLinks('[[Cible|<b>gras</b>]]');
		expect(result).not.toContain('<b>');
		expect(result).toContain('&lt;b&gt;');
	});

	it('encodes a target with angle brackets in data-mdsh-wiki', () => {
		const result = preprocessWikiLinks('[[<hostile>]]');
		// encodeURIComponent('<hostile>') gives %3Chostile%3E, so the attribute has no raw < character.
		expect(result).not.toMatch(/data-mdsh-wiki="[^"]*</);
	});

	it('keeps Markdown unchanged when it has no wiki link', () => {
		const md = '# Titre\n\nUn paragraphe.';
		expect(preprocessWikiLinks(md)).toBe(md);
	});

	it('supports multiple wiki links in one string', () => {
		const result = preprocessWikiLinks('[[A]] et [[B]]');
		const count = (result.match(/class="wiki-link"/g) ?? []).length;
		expect(count).toBe(2);
	});

	it('ignores wiki links with an empty target', () => {
		// Keep the raw match when the target is empty.
		const result = preprocessWikiLinks('[[]]');
		expect(result).toBe('[[]]');
	});

	it('accepts a target with surrounding spaces', () => {
		const result = preprocessWikiLinks('[[ Mon Fichier ]]');
		expect(result).toContain('data-mdsh-wiki="Mon%20Fichier"');
	});

	it('does not transform a wiki link in inline code', () => {
		const result = preprocessWikiLinks('Tape `[[Cible]]` pour lier.');
		expect(result).toBe('Tape `[[Cible]]` pour lier.');
		expect(result).not.toContain('wiki-link');
	});

	it('does not transform a wiki link inside a fenced code block', () => {
		const md = 'Avant\n\n```\n[[Cible]]\n```\n\nAprès [[Réel]]';
		const result = preprocessWikiLinks(md);
		// Keep the fenced target literal and transform the target outside code.
		expect(result).toContain('```\n[[Cible]]\n```');
		expect(result).toContain('data-mdsh-wiki="R%C3%A9el"');
		expect((result.match(/class="wiki-link"/g) ?? []).length).toBe(1);
	});
});

describe('decodeWikiTarget', () => {
	it('decodes a standard encodeURIComponent value', () => {
		expect(decodeWikiTarget('Mon%20fichier.md')).toBe('Mon fichier.md');
	});

	it('round-trips a target through encodeURIComponent', () => {
		const original = 'Réunion 2026 - Rapport final.md';
		const encoded = encodeURIComponent(original);
		expect(decodeWikiTarget(encoded)).toBe(original);
	});

	it('returns the raw value after a decoding failure', () => {
		// `%ZZ` is not a valid URI sequence.
		expect(decodeWikiTarget('%ZZ')).toBe('%ZZ');
	});

	it('returns an empty string for empty input', () => {
		expect(decodeWikiTarget('')).toBe('');
	});

	it('round-trips a target with angle brackets', () => {
		const original = '<hostile>';
		expect(decodeWikiTarget(encodeURIComponent(original))).toBe(original);
	});
});

describe('extractWikiLinkTargets', () => {
	it('ignores links in fenced code blocks', () => {
		const md = 'Avant [[Real]]\n```md\n[[ExampleInFence]]\n```\nApres [[AlsoReal]]\n`[[inline]]`';
		expect(extractWikiLinkTargets(md).sort()).toEqual(['AlsoReal', 'Real']);
	});

	it('extracts a simple target', () => {
		const targets = extractWikiLinkTargets('Voir [[Notes de réunion]]');
		expect(targets).toEqual(['Notes de réunion']);
	});

	it('extracts the target without the alias from [[X|alias]]', () => {
		const targets = extractWikiLinkTargets('[[Rapport|Voir ici]]');
		expect(targets).toEqual(['Rapport']);
	});

	it('removes duplicate targets', () => {
		const md = '[[A]] et [[A]] encore [[A]]';
		const targets = extractWikiLinkTargets(md);
		expect(targets).toEqual(['A']);
	});

	it('extracts multiple distinct targets', () => {
		const targets = extractWikiLinkTargets('[[A]] [[B]] [[C]]');
		expect(new Set(targets)).toEqual(new Set(['A', 'B', 'C']));
	});

	it('returns an empty array when there is no wiki link', () => {
		expect(extractWikiLinkTargets('Aucun lien ici.')).toEqual([]);
	});

	it('trims spaces around targets', () => {
		const targets = extractWikiLinkTargets('[[ Mon Fichier ]]');
		expect(targets).toEqual(['Mon Fichier']);
	});

	it('ignores wiki links with no target', () => {
		const targets = extractWikiLinkTargets('[[]]');
		expect(targets).toEqual([]);
	});
});
