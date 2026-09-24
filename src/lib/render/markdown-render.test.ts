import { describe, it, expect } from 'vitest';
import { renderMarkdown, renderMarkdownDetailed } from './markdown';

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
});
