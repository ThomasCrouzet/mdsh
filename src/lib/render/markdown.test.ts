import { describe, it, expect } from 'vitest';
import { hasMath, hasMermaid, renderMarkdown } from './markdown';

describe('renderMarkdown - basic Markdown', () => {
	it('renders an H1 without interactive decoration by default', async () => {
		const html = await renderMarkdown('# Hello');
		expect(html).toMatch(/<h1[^>]*id="hello"[^>]*>Hello/);
		expect(html).not.toContain('class="mdsh-anchor"');
	});

	it('adds heading permalinks only on request', async () => {
		const html = await renderMarkdown('# Hello', { headingPermalinks: true });
		expect(html).toContain('class="mdsh-anchor"');
		expect(html).toContain('href="#hello"');
		expect(html).toContain('aria-hidden="true"></a>');
		expect(html).not.toContain('>#</a>');
	});

	it('renders emphasis', async () => {
		const html = await renderMarkdown('**gras** et *italique*');
		expect(html).toContain('<strong>gras</strong>');
		expect(html).toContain('<em>italique</em>');
	});

	it('renders a link', async () => {
		const html = await renderMarkdown('[mdsh](https://example.com)');
		expect(html).toMatch(/<a href="https:\/\/example\.com"[^>]*>mdsh<\/a>/);
	});

	it('renders an unordered list', async () => {
		const html = await renderMarkdown('- un\n- deux');
		expect(html).toContain('<ul>');
		expect(html).toContain('<li>un</li>');
	});
});

describe('renderMarkdown - GFM', () => {
	it('renders a table', async () => {
		const html = await renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |');
		expect(html).toContain('<table>');
		expect(html).toContain('<th>a</th>');
		expect(html).toContain('<td>1</td>');
	});

	it('renders a checklist', async () => {
		const html = await renderMarkdown('- [ ] à faire\n- [x] fait');
		expect(html).toContain('<ul class="contains-task-list">');
		expect(html.match(/class="task-list-item"/g)).toHaveLength(2);
		expect(html).toContain('type="checkbox"');
		expect(html).toMatch(/checked/);
	});

	it('keeps markers for standard items in a mixed list', async () => {
		const html = await renderMarkdown('- [ ] à faire\n- élément ordinaire');
		expect(html).toContain('<li class="task-list-item">');
		expect(html).toContain('<li>élément ordinaire</li>');
	});

	it('renders strikethrough', async () => {
		const html = await renderMarkdown('~~barré~~');
		expect(html).toContain('<del>barré</del>');
	});
});

describe('renderMarkdown - code blocks', () => {
	it('applies highlight.js to JavaScript', async () => {
		const html = await renderMarkdown('```js\nconst x = 1;\n```');
		expect(html).toContain('hljs');
		expect(html).toContain('language-js');
		expect(html).toMatch(/class="hljs-keyword"/);
	});

	it('supports an unknown language without an error', async () => {
		const html = await renderMarkdown('```gibberish\nfoo bar\n```');
		// Section B1.9: `<pre>` has an aria-label. French uses "Bloc de code" for an unknown language.
		expect(html).toMatch(/<pre[^>]*aria-label="Bloc de code"/);
		expect(html).toContain('<code');
	});

	it('keeps inline code', async () => {
		const html = await renderMarkdown('Voir `run()` pour lancer');
		expect(html).toContain('<code>run()</code>');
	});
});

describe('renderMarkdown - math KaTeX', () => {
	it('renders an inline formula', async () => {
		const html = await renderMarkdown('Soit $a^2 + b^2 = c^2$ un théorème');
		expect(html).toContain('katex');
		expect(html).not.toContain('$a^2');
	});

	it('renders a block formula', async () => {
		const html = await renderMarkdown('$$\n\\int_0^1 x\\,dx = \\frac{1}{2}\n$$');
		expect(html).toContain('math-block');
		expect(html).toContain('katex');
	});

	it('handles invalid TeX without an error', async () => {
		const html = await renderMarkdown('$\\badcommand{}$');
		expect(typeof html).toBe('string');
		expect(html.length).toBeGreaterThan(0);
	});

	it('does not parse a price as math', async () => {
		const html = await renderMarkdown('Prix : $10 - rien à voir');
		expect(html).not.toContain('katex');
		expect(html).toContain('Prix');
	});

	it('works with code blocks', async () => {
		const html = await renderMarkdown('Formule $E = mc^2$\n\n```js\nconst $ = 1;\n```');
		expect(html).toContain('katex');
		expect(html).toContain('hljs');
	});

	it('renders a display formula in the middle of a line', async () => {
		const html = await renderMarkdown('Voici $$a^2+b^2$$ inline.');
		expect(html).toContain('katex');
		expect(html).not.toContain('$$a^2');
	});
});

describe('hasMath', () => {
	it('detects inline math', () => {
		expect(hasMath('a $x$ b')).toBe(true);
	});
	it('detects block math', () => {
		expect(hasMath('$$\nx\n$$')).toBe(true);
	});
	it('rejects plain text', () => {
		expect(hasMath('rien de spécial')).toBe(false);
	});
	it('does not classify $10 as math', () => {
		expect(hasMath('prix $10 ici')).toBe(false);
	});
	it('matches the tokenizer when a digit follows a closing dollar sign', () => {
		// The tokenizer rejects `$x$5` through `(?!\d)`, so hasMath must not return a false positive.
		expect(hasMath('$x$5')).toBe(false);
	});
	it('detects display math in the middle of a line', () => {
		expect(hasMath('texte $$x$$ suite')).toBe(true);
	});
});

describe('hasMermaid', () => {
	it('detects a Mermaid block', () => {
		expect(hasMermaid('```mermaid\ngraph TD\n```')).toBe(true);
	});
	it('detects a tilde fence', () => {
		expect(hasMermaid('~~~mermaid\ngraph TD\n~~~')).toBe(true);
	});
	it('rejects mermaid outside a code block language', () => {
		expect(hasMermaid('Voir mermaid en action')).toBe(false);
	});
	it('rejects a similar language', () => {
		expect(hasMermaid('```mermaidx\ncontent\n```')).toBe(false);
	});
});

describe('renderMarkdown - Mermaid extraction', () => {
	it('keeps Markdown without a Mermaid block', async () => {
		const html = await renderMarkdown('# Hello\n\ndu texte');
		expect(html).not.toContain('mermaid-block');
		expect(html).not.toContain('MERMAID-');
	});

	// Do not test actual SVG rendering here. Mermaid requires a full DOM with bounding-box measurements.
	// Run visual integration tests in the development application.
});

describe('renderMarkdown - front-matter (§5.1)', () => {
	it('removes the leading YAML block', async () => {
		const md = `---
title: Doc
author: Thomas
---

# Contenu`;
		const html = await renderMarkdown(md);
		expect(html).toContain('<h1');
		expect(html).toContain('Contenu');
		// Raw YAML must not appear in the HTML.
		expect(html).not.toContain('---\ntitle');
		expect(html).not.toContain('author: Thomas');
	});

	it('inserts metadata in an mdsh-frontmatter aside', async () => {
		const md = `---
title: Doc
author: Thomas
---

corps`;
		const html = await renderMarkdown(md);
		expect(html).toContain('mdsh-frontmatter');
		expect(html).toContain('Thomas');
	});

	it('renders YAML tags as chips', async () => {
		const md = `---
tags: [notes, projet-x]
---

corps`;
		const html = await renderMarkdown(md);
		expect(html).toContain('mdsh-frontmatter-tag');
		expect(html).toContain('notes');
		expect(html).toContain('projet-x');
	});

	it('omits the front matter block when showFrontmatter is false', async () => {
		const md = `---
author: Thomas
---

corps`;
		const html = await renderMarkdown(md, { showFrontmatter: false });
		expect(html).not.toContain('mdsh-frontmatter');
	});

	it('escapes front matter values to prevent HTML injection', async () => {
		const md = `---
author: '<img src=x onerror=alert(1)>'
---

corps`;
		const html = await renderMarkdown(md);
		// Escape the <img> tag as text. The final DOM must not contain an executable element.
		expect(html).not.toMatch(/<img\s+[^>]*src=x/i);
		// The word "onerror" can remain as text, such as "&lt;img onerror=...&gt;".
		// It must not remain as an attribute.
		expect(html).not.toMatch(/<\w+[^>]*\sonerror=/i);
	});

	it('renders normally with invalid front matter', async () => {
		const md = `---
title: ::: invalid : : :
tags: [unclosed
---

# Reste`;
		const html = await renderMarkdown(md);
		expect(html).toContain('<h1');
		expect(html).toContain('Reste');
	});
});

describe('renderMarkdown - wiki-links (§5.2)', () => {
	it('converts a wiki target to a wiki-link anchor', async () => {
		const html = await renderMarkdown('Voir [[Notes]] pour plus.');
		expect(html).toContain('class="wiki-link"');
		// Encode the data attribute as a URI. ASCII text such as "Notes" remains unchanged.
		expect(html).toContain('data-mdsh-wiki="Notes"');
		expect(html).toContain('>Notes</a>');
	});

	it('converts a wiki alias to a link with an alias label', async () => {
		const html = await renderMarkdown('Voir [[notes-projet|mes notes]] ici.');
		expect(html).toContain('data-mdsh-wiki="notes-projet"');
		expect(html).toContain('>mes notes</a>');
	});

	it('creates an mdsh-wiki slug href', async () => {
		const html = await renderMarkdown('[[Mon Document]]');
		expect(html).toContain('#mdsh-wiki-mon-document');
	});

	it('escapes label HTML and encodes the data attribute', async () => {
		const html = await renderMarkdown('[[<script>alert(1)</script>]]');
		// The <script> tag must not be executable.
		expect(html).not.toMatch(/<script[^>]*>/i);
		// Encode the data attribute for a URL to preserve the target through DOMPurify.
		// Encode `<` and `>` as `%3C` and `%3E`.
		expect(html).toMatch(/data-mdsh-wiki="[^"]*%3C[^"]*"/i);
	});

	it('keeps a single-bracket link unchanged', async () => {
		const html = await renderMarkdown('Un [lien](https://example.com)');
		expect(html).not.toContain('wiki-link');
		expect(html).toContain('href="https://example.com"');
	});

	it('supports multiple wiki links in one paragraph', async () => {
		const html = await renderMarkdown('Voir [[A]] et [[B|alias B]].');
		// Count occurrences of class="wiki-link".
		const matches = html.match(/class="wiki-link"/g) ?? [];
		expect(matches.length).toBe(2);
	});
});

describe('renderMarkdown - tabnabbing protection (P1.1)', () => {
	it('sets rel on an external HTTPS link', async () => {
		const html = await renderMarkdown('[exemple](https://example.com)');
		// The link must have target="_blank" and rel="noopener noreferrer".
		expect(html).toContain('target="_blank"');
		expect(html).toContain('rel="noopener noreferrer"');
	});

	it('sets rel on an external HTTP link', async () => {
		const html = await renderMarkdown('[insecure](http://example.com)');
		expect(html).toContain('rel="noopener noreferrer"');
	});

	it('sets rel on a raw HTML anchor with a blank target', async () => {
		// Simulate a hostile .md file imported through drag and drop or the share target.
		const html = await renderMarkdown('<a href="https://evil.tld" target="_blank">clic</a>');
		expect(html).toContain('rel="noopener noreferrer"');
	});

	it('does not add target or rel to an internal wiki link', async () => {
		// Wiki links generate href="#mdsh-wiki-<slug>", which is a local anchor.
		const html = await renderMarkdown('Voir [[Notes]]');
		// Get only the wiki link <a> with href="#mdsh-wiki-notes".
		const wikiLink = html.match(/<a[^>]+href="#mdsh-wiki-notes"[^>]*>/)?.[0] ?? '';
		expect(wikiLink).toBeTruthy();
		expect(wikiLink).not.toContain('rel="noopener noreferrer"');
		expect(wikiLink).not.toContain('target="_blank"');
	});

	it('does not add target or rel to a local anchor', async () => {
		// Heading anchors are internal links and must remain unchanged.
		const html = await renderMarkdown('# Mon titre', { headingPermalinks: true });
		// L'ancre permalink porte href="#mon-titre"
		const anchor = html.match(/<a[^>]+href="#mon-titre"[^>]*>/)?.[0] ?? '';
		expect(anchor).toBeTruthy();
		expect(anchor).not.toContain('rel="noopener noreferrer"');
	});
});

describe('renderMarkdown - XSS sanitization', () => {
	it('removes script elements', async () => {
		const html = await renderMarkdown('Avant\n\n<script>alert(1)</script>\n\nAprès');
		expect(html).not.toContain('<script');
		expect(html).not.toContain('alert(1)');
		expect(html).toContain('Avant');
		expect(html).toContain('Après');
	});

	it('removes event handler attributes', async () => {
		const html = await renderMarkdown(
			'<img src="x" onerror="alert(1)">\n\n<div onload="alert(2)" onclick="alert(3)">x</div>'
		);
		expect(html).not.toContain('onerror');
		expect(html).not.toContain('onload');
		expect(html).not.toContain('onclick');
		expect(html).not.toMatch(/alert\(\d\)/);
	});

	it('removes JavaScript href values', async () => {
		const html = await renderMarkdown('[clic](javascript:alert(1))');
		expect(html).not.toContain('javascript:');
		expect(html).not.toContain('alert(1)');
	});

	it('removes iframe elements', async () => {
		const html = await renderMarkdown('<iframe src="https://evil.tld"></iframe>\n\nOK');
		expect(html).not.toContain('<iframe');
		expect(html).not.toContain('evil.tld');
		expect(html).toContain('OK');
	});

	it('removes object, embed, and form elements', async () => {
		const html = await renderMarkdown(
			'<object data="x.swf"></object>\n<embed src="x">\n<form action="//evil"><input name=pw></form>'
		);
		expect(html).not.toContain('<object');
		expect(html).not.toContain('<embed');
		expect(html).not.toContain('<form');
	});

	it('keeps valid HTTPS links', async () => {
		const html = await renderMarkdown('[ok](https://example.com/path)');
		expect(html).toContain('href="https://example.com/path"');
	});

	it('keeps GFM task lists after sanitization', async () => {
		const html = await renderMarkdown('- [ ] todo\n- [x] done');
		expect(html).toContain('type="checkbox"');
		expect(html).toMatch(/checked/);
	});

	it('keeps KaTeX output after sanitization', async () => {
		const html = await renderMarkdown('$a^2 + b^2 = c^2$');
		expect(html).toContain('katex');
	});
});
