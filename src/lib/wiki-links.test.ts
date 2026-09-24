import { describe, it, expect } from 'vitest';
import {
	slugify,
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
	it('supports a title with hyphens and composed uppercase characters', () => {
		expect(slugify('Réunion RH - 2026')).toBe('reunion-rh-2026');
	});
});

describe('preprocessWikiLinks', () => {
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
		expect(result).toContain('&lt;script&gt;');
	});

	it('escapes HTML characters in the alias', () => {
		const result = preprocessWikiLinks('[[Cible|<b>gras</b>]]');
		expect(result).not.toContain('<b>');
		expect(result).toContain('&lt;b&gt;');
	});

	it('does not transform a wiki link inside a fenced code block', () => {
		const md = 'Avant\n\n```\n[[Cible]]\n```\n\nAprès [[Réel]]';
		const result = preprocessWikiLinks(md);
		expect(result).toContain('```\n[[Cible]]\n```');
		expect(result).toContain('data-mdsh-wiki="R%C3%A9el"');
		expect((result.match(/class="wiki-link"/g) ?? []).length).toBe(1);
	});
});

describe('decodeWikiTarget', () => {
	it('returns the raw value after a decoding failure', () => {
		expect(decodeWikiTarget('%ZZ')).toBe('%ZZ');
	});
});

describe('extractWikiLinkTargets', () => {
	it('ignores links in fenced code blocks', () => {
		const md = 'Avant [[Real]]\n```md\n[[ExampleInFence]]\n```\nApres [[AlsoReal]]\n`[[inline]]`';
		expect(extractWikiLinkTargets(md).sort()).toEqual(['AlsoReal', 'Real']);
	});

	it('removes duplicate targets', () => {
		const md = '[[A]] et [[A]] encore [[A]]';
		const targets = extractWikiLinkTargets(md);
		expect(targets).toEqual(['A']);
	});
});
