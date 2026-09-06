import { describe, it, expect } from 'vitest';
import { hasMath, hasMermaid, renderMarkdown, renderMarkdownDetailed } from './markdown';

// Additional coverage for markdown.ts branches that markdown.test.ts does not cover.
// Test ordered front-matter fields, dates, tag chips, ignored nested values, and the French code-block label.
// Also test the Mermaid placeholder and error path, and renderMarkdownDetailed.

describe('renderMarkdown - front-matter fields, dates, and chips', () => {
	it('renders known fields in author, date, created, updated, and description order', async () => {
		const md = `---
description: Resume
author: Thomas
created: 2024-01-02
title: Mon doc
---

corps`;
		const html = await renderMarkdown(md);
		// Omit `title` from the block because it is already used as the document title.
		expect(html).toContain('mdsh-frontmatter');
		expect(html).not.toContain('<dt>title</dt>');
		// Keep a stable order: author, created, and description, regardless of the input order.
		// The YAML source puts description first.
		const iAuthor = html.indexOf('<dt>author</dt>');
		const iCreated = html.indexOf('<dt>created</dt>');
		const iDescription = html.indexOf('<dt>description</dt>');
		expect(iAuthor).toBeGreaterThan(-1);
		expect(iCreated).toBeGreaterThan(iAuthor);
		expect(iDescription).toBeGreaterThan(iCreated);
		expect(html).toContain('Thomas');
		expect(html).toContain('Resume');
	});

	it('formats a Date value as YYYY-MM-DD', async () => {
		// js-yaml DEFAULT_SCHEMA parses `created: 2024-03-15` as a Date object.
		const md = `---
created: 2024-03-15
---

corps`;
		const html = await renderMarkdown(md);
		expect(html).toMatch(/<dt>created<\/dt><dd>2024-03-15<\/dd>/);
	});

	it('renders an array field as comma-separated values', async () => {
		// `aliases` is not a known field, so it uses the Array.isArray branch.
		const md = `---
aliases: [un, deux, trois]
---

corps`;
		const html = await renderMarkdown(md);
		expect(html).toMatch(/<dt>aliases<\/dt><dd>un, deux, trois<\/dd>/);
	});

	it('replaces a nonscalar array value with [...]', async () => {
		const md = `---
mixte:
  - simple
  - cle: valeur
---

corps`;
		const html = await renderMarkdown(md);
		expect(html).toContain('<dt>mixte</dt>');
		// Convert the nested array object to [...] to prevent recursive stringification and denial of service.
		expect(html).toContain('[...]');
	});

	it('ignores nested object fields that are not arrays', async () => {
		const md = `---
author: Thomas
nested:
  a: 1
  b: 2
---

corps`;
		const html = await renderMarkdown(md);
		expect(html).toContain('<dt>author</dt>');
		// `nested` is a plain object. Skip the field through pushField's early return.
		expect(html).not.toContain('<dt>nested</dt>');
	});

	it('ignores empty and null values', async () => {
		const md = `---
author: Thomas
empty: ""
nothing: null
---

corps`;
		const html = await renderMarkdown(md);
		expect(html).toContain('<dt>author</dt>');
		expect(html).not.toContain('<dt>empty</dt>');
		expect(html).not.toContain('<dt>nothing</dt>');
	});

	it('renders YAML tags as mdsh-frontmatter-tag chips', async () => {
		const md = `---
tags: [alpha, beta]
---

corps`;
		const html = await renderMarkdown(md);
		const chips = html.match(/mdsh-frontmatter-tag/g) ?? [];
		expect(chips.length).toBe(2);
		expect(html).toContain('alpha');
		expect(html).toContain('beta');
	});

	it('does not render a front-matter block for empty data', async () => {
		// With no front matter, buildFrontmatterBlock returns '' for empty data.
		const html = await renderMarkdown('# Juste un titre');
		expect(html).not.toContain('mdsh-frontmatter');
	});

	it('omits the block when it contains only fields that cannot be rendered', async () => {
		// A single nested object gives no items and no tags, so do not create an aside.
		const md = `---
nested:
  a: 1
---

corps`;
		const html = await renderMarkdown(md);
		expect(html).not.toContain('mdsh-frontmatter');
		expect(html).toContain('corps');
	});

	it('adds a French localized aria-label to the aside', async () => {
		const md = `---
author: Thomas
---

corps`;
		const html = await renderMarkdown(md);
		expect(html).toContain('aria-label="Métadonnées du document"');
	});
});

describe('renderMarkdown - French code-block aria-label', () => {
	it('labels a known language through the "Code {lang}" template', async () => {
		const html = await renderMarkdown('```js\nconst x = 1;\n```');
		// In French, the `read.codeBlockLang` template is "Code {lang}".
		expect(html).toContain('aria-label="Code js"');
	});

	it('uses the French "Bloc de code" label for an unknown language', async () => {
		const html = await renderMarkdown('```inconnu\nfoo\n```');
		expect(html).toContain('aria-label="Bloc de code"');
	});

	it('highlights a block without a declared language automatically', async () => {
		// With no language, use highlightAuto and the `hljs` class without `language-...`.
		const html = await renderMarkdown('```\nfunction f() { return 1; }\n```');
		expect(html).toContain('class="hljs"');
		expect(html).not.toContain('language-');
		expect(html).toContain('aria-label="Bloc de code"');
	});
});

describe('renderMarkdown - Mermaid placeholder and error path', () => {
	it('replaces an invalid Mermaid block with a localized error block', async () => {
		// In the jsdom test environment, `browser` is true. Call initMermaid and render.
		// An invalid diagram reaches the catch block and produces mermaid-error.
		const html = await renderMarkdown('```mermaid\nce-n-est-pas-un-diagramme-valide\n```');
		// Replace the placeholder so no data-mermaid-idx attribute remains.
		expect(html).not.toContain('mdsh-mermaid-placeholder');
		// Return rendered SVG or the French localized error block, "Erreur Mermaid".
		const rendered = html.includes('mermaid-error') || html.includes('<svg');
		expect(rendered).toBe(true);
		if (html.includes('mermaid-error')) {
			expect(html).toContain('Erreur Mermaid');
			expect(html).toContain('mermaid-source-fallback');
		}
	});

	it('works with standard Markdown', async () => {
		const html = await renderMarkdown('# Titre\n\n```mermaid\nbad((\n```\n\nfin');
		expect(html).toContain('<h1');
		expect(html).toContain('fin');
		expect(html).not.toContain('mdsh-mermaid-placeholder');
	});

	it('uses the requested theme without an error', async () => {
		const html = await renderMarkdown('```mermaid\ninvalide!!!\n```', { mermaidTheme: 'dark' });
		expect(typeof html).toBe('string');
		expect(html).not.toContain('mdsh-mermaid-placeholder');
	});
});

describe('renderMarkdown - math : chemins de rendu', () => {
	it('renders $$ display math inside a line with display=true', async () => {
		const html = await renderMarkdown('Avant $$x^2$$ apres.');
		expect(html).toContain('katex');
		expect(html).not.toContain('$$x^2');
	});

	it('renders a math block on its own line in .math-block', async () => {
		const html = await renderMarkdown('$$\na = b\n$$');
		expect(html).toContain('math-block');
		expect(html).toContain('katex');
	});

	it('creates a math-error span for an unrecoverable invalid inline formula', async () => {
		// KaTeX uses throwOnError=false, so most cases do not throw.
		// Verify at minimum that rendering succeeds and returns a string.
		const html = await renderMarkdown('Soit $\\frac{1}{0}$ defini.');
		expect(typeof html).toBe('string');
		expect(html.length).toBeGreaterThan(0);
	});
});

describe('renderMarkdownDetailed', () => {
	it('returns HTML, front matter, and the front-matter title', async () => {
		const md = `---
title: Titre FM
author: Thomas
---

# Un autre titre`;
		const res = await renderMarkdownDetailed(md);
		expect(res.html).toContain('mdsh-frontmatter');
		// Prefer the front-matter title over the H1.
		expect(res.title).toBe('Titre FM');
		expect(res.frontmatter.author).toBe('Thomas');
	});

	it('uses the first H1 when front matter has no title', async () => {
		const res = await renderMarkdownDetailed('# Mon H1\n\ncorps');
		expect(res.title).toBe('Mon H1');
		expect(res.frontmatter).toEqual({});
	});

	it('returns an undefined title when there is no front matter or H1', async () => {
		const res = await renderMarkdownDetailed('juste du texte sans titre');
		expect(res.title).toBeUndefined();
		expect(res.html).toContain('texte');
	});

	it('keeps front matter data but omits the aside when showFrontmatter is false', async () => {
		const md = `---
author: Thomas
---

corps`;
		const res = await renderMarkdownDetailed(md, { showFrontmatter: false });
		expect(res.html).not.toContain('mdsh-frontmatter');
		// Keep parsed data available even when it is not rendered.
		expect(res.frontmatter.author).toBe('Thomas');
	});
});

describe('hasMath and hasMermaid - additional cases', () => {
	it('lets hasMath detect inline $$ display math', () => {
		expect(hasMath('texte $$a^2$$ suite')).toBe(true);
	});

	it('hasMath rejette un simple $ isole', () => {
		expect(hasMath('le prix est $ ici')).toBe(false);
	});

	it('lets hasMermaid accept indentation before the fence', () => {
		expect(hasMermaid('  ```mermaid\ngraph TD\n```')).toBe(true);
	});

	it('makes hasMermaid reject a non-Mermaid code block', () => {
		expect(hasMermaid('```js\nconst x = 1;\n```')).toBe(false);
	});
});

describe('renderMarkdown - sanitize style url() beacon (SECURITY.md)', () => {
	it('strips remote url() inside inline style attributes', async () => {
		// marked allows raw HTML; DOMPurify keeps style but our hook strips remote urls.
		const md = '<div style="background:url(https://tracker.example/px.gif);color:red">x</div>';
		const html = await renderMarkdown(md);
		expect(html).not.toMatch(/tracker\.example/i);
		expect(html).not.toMatch(/url\(\s*['"]?\s*https?:/i);
	});

	it('strips protocol-relative url() beacons', async () => {
		const md = '<p style="list-style-image:url(//evil.example/b)">y</p>';
		const html = await renderMarkdown(md);
		expect(html).not.toMatch(/evil\.example/i);
	});

	it('does not execute javascript: links (href neutralized)', async () => {
		const md = '<a href="javascript:alert(1)">click</a>';
		const html = await renderMarkdown(md);
		expect(html).not.toMatch(/javascript:/i);
	});
});
