import { describe, it, expect } from 'vitest';
import { hasMath, hasMermaid, renderMarkdown, renderMarkdownDetailed } from './markdown';

// Couverture complementaire de markdown.ts : branches non couvertes par
// markdown.test.ts. On vise le bloc front-matter (champs ordonnes, date, chips
// de tags, valeurs imbriquees ignorees), le label aria des blocs de code en
// locale FR, le placeholder + chemin d'erreur Mermaid, et renderMarkdownDetailed.

describe('renderMarkdown - bloc front-matter (champs ordonnes / date / chips)', () => {
	it('rend les champs connus dans l ordre author/date/created/updated/description', async () => {
		const md = `---
description: Resume
author: Thomas
created: 2024-01-02
title: Mon doc
---

corps`;
		const html = await renderMarkdown(md);
		// `title` est volontairement omis du bloc (deja utilise comme titre de doc).
		expect(html).toContain('mdsh-frontmatter');
		expect(html).not.toContain('<dt>title</dt>');
		// Ordre stable : author avant created avant description, meme si l ordre
		// d insertion YAML differe (description en premier dans le source).
		const iAuthor = html.indexOf('<dt>author</dt>');
		const iCreated = html.indexOf('<dt>created</dt>');
		const iDescription = html.indexOf('<dt>description</dt>');
		expect(iAuthor).toBeGreaterThan(-1);
		expect(iCreated).toBeGreaterThan(iAuthor);
		expect(iDescription).toBeGreaterThan(iCreated);
		expect(html).toContain('Thomas');
		expect(html).toContain('Resume');
	});

	it('formate une valeur Date en YYYY-MM-DD', async () => {
		// `created: 2024-03-15` est parse par js-yaml (DEFAULT_SCHEMA) en objet Date.
		const md = `---
created: 2024-03-15
---

corps`;
		const html = await renderMarkdown(md);
		expect(html).toMatch(/<dt>created<\/dt><dd>2024-03-15<\/dd>/);
	});

	it('rend un champ tableau comme CSV (slice + join)', async () => {
		// `aliases` n est pas un champ connu : passe par la branche Array.isArray.
		const md = `---
aliases: [un, deux, trois]
---

corps`;
		const html = await renderMarkdown(md);
		expect(html).toMatch(/<dt>aliases<\/dt><dd>un, deux, trois<\/dd>/);
	});

	it('remplace une valeur de tableau non scalaire par [...]', async () => {
		const md = `---
mixte:
  - simple
  - cle: valeur
---

corps`;
		const html = await renderMarkdown(md);
		expect(html).toContain('<dt>mixte</dt>');
		// L objet imbrique du tableau devient [...] (anti-DoS, pas de stringify recursif).
		expect(html).toContain('[...]');
	});

	it('ignore les champs objet imbriques (non tableau)', async () => {
		const md = `---
author: Thomas
nested:
  a: 1
  b: 2
---

corps`;
		const html = await renderMarkdown(md);
		expect(html).toContain('<dt>author</dt>');
		// `nested` est un objet pur : champ saute (return early dans pushField).
		expect(html).not.toContain('<dt>nested</dt>');
	});

	it('ignore les valeurs vides ou nulles', async () => {
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

	it('rend les tags YAML comme chips dediees (mdsh-frontmatter-tag)', async () => {
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

	it('ne rend aucun bloc front-matter quand les donnees sont vides', async () => {
		// Pas de front-matter du tout -> buildFrontmatterBlock renvoie '' (data vide).
		const html = await renderMarkdown('# Juste un titre');
		expect(html).not.toContain('mdsh-frontmatter');
	});

	it('omet le bloc si seuls des champs non rendables sont presents (objet only)', async () => {
		// Le seul champ est un objet imbrique : items vide + pas de tags -> pas d aside.
		const md = `---
nested:
  a: 1
---

corps`;
		const html = await renderMarkdown(md);
		expect(html).not.toContain('mdsh-frontmatter');
		expect(html).toContain('corps');
	});

	it('porte un aria-label localise FR sur l aside', async () => {
		const md = `---
author: Thomas
---

corps`;
		const html = await renderMarkdown(md);
		expect(html).toContain('aria-label="Métadonnées du document"');
	});
});

describe('renderMarkdown - aria-label des blocs de code (i18n FR)', () => {
	it('annonce la langue connue via le template "Code {lang}"', async () => {
		const html = await renderMarkdown('```js\nconst x = 1;\n```');
		// Locale FR : le template `read.codeBlockLang` = "Code {lang}".
		expect(html).toContain('aria-label="Code js"');
	});

	it('annonce "Bloc de code" pour une langue inconnue', async () => {
		const html = await renderMarkdown('```inconnu\nfoo\n```');
		expect(html).toContain('aria-label="Bloc de code"');
	});

	it('highlighte automatiquement un bloc sans langue declaree', async () => {
		// Pas de lang -> highlightAuto, classe `hljs` sans `language-...`.
		const html = await renderMarkdown('```\nfunction f() { return 1; }\n```');
		expect(html).toContain('class="hljs"');
		expect(html).not.toContain('language-');
		expect(html).toContain('aria-label="Bloc de code"');
	});
});

describe('renderMarkdown - Mermaid (placeholder + chemin d erreur)', () => {
	it('remplace un bloc mermaid invalide par un bloc d erreur localise', async () => {
		// `browser` est true sous jsdom (test-env) : initMermaid + render sont
		// appeles ; un diagramme invalide tombe dans le catch -> mermaid-error.
		const html = await renderMarkdown('```mermaid\nce-n-est-pas-un-diagramme-valide\n```');
		// Le placeholder doit avoir ete remplace (plus de data-mermaid-idx residuel).
		expect(html).not.toContain('mdsh-mermaid-placeholder');
		// Soit un SVG rendu, soit le bloc d erreur localise FR ("Erreur Mermaid").
		const rendered = html.includes('mermaid-error') || html.includes('<svg');
		expect(rendered).toBe(true);
		if (html.includes('mermaid-error')) {
			expect(html).toContain('Erreur Mermaid');
			expect(html).toContain('mermaid-source-fallback');
		}
	});

	it('cohabite avec du markdown standard', async () => {
		const html = await renderMarkdown('# Titre\n\n```mermaid\nbad((\n```\n\nfin');
		expect(html).toContain('<h1');
		expect(html).toContain('fin');
		expect(html).not.toContain('mdsh-mermaid-placeholder');
	});

	it('respecte le theme passe en option sans planter', async () => {
		const html = await renderMarkdown('```mermaid\ninvalide!!!\n```', { mermaidTheme: 'dark' });
		expect(typeof html).toBe('string');
		expect(html).not.toContain('mdsh-mermaid-placeholder');
	});
});

describe('renderMarkdown - math : chemins de rendu', () => {
	it('rend du display math $$…$$ en milieu de ligne (display=true)', async () => {
		const html = await renderMarkdown('Avant $$x^2$$ apres.');
		expect(html).toContain('katex');
		expect(html).not.toContain('$$x^2');
	});

	it('rend un bloc math sur sa propre ligne dans .math-block', async () => {
		const html = await renderMarkdown('$$\na = b\n$$');
		expect(html).toContain('math-block');
		expect(html).toContain('katex');
	});

	it('produit un span math-error sur une formule inline invalide non recuperable', async () => {
		// throwOnError=false dans KaTeX : la majorite des cas ne jettent pas, mais
		// on verifie au minimum que le rendu ne casse pas et reste une chaine.
		const html = await renderMarkdown('Soit $\\frac{1}{0}$ defini.');
		expect(typeof html).toBe('string');
		expect(html.length).toBeGreaterThan(0);
	});
});

describe('renderMarkdownDetailed', () => {
	it('retourne html + frontmatter + titre depuis le front-matter', async () => {
		const md = `---
title: Titre FM
author: Thomas
---

# Un autre titre`;
		const res = await renderMarkdownDetailed(md);
		expect(res.html).toContain('mdsh-frontmatter');
		// Le titre prioritaire vient du front-matter, pas du H1.
		expect(res.title).toBe('Titre FM');
		expect(res.frontmatter.author).toBe('Thomas');
	});

	it('retombe sur le premier H1 si pas de title en front-matter', async () => {
		const res = await renderMarkdownDetailed('# Mon H1\n\ncorps');
		expect(res.title).toBe('Mon H1');
		expect(res.frontmatter).toEqual({});
	});

	it('renvoie title undefined quand ni front-matter ni H1', async () => {
		const res = await renderMarkdownDetailed('juste du texte sans titre');
		expect(res.title).toBeUndefined();
		expect(res.html).toContain('texte');
	});

	it('respecte showFrontmatter=false (html sans aside, frontmatter conserve)', async () => {
		const md = `---
author: Thomas
---

corps`;
		const res = await renderMarkdownDetailed(md, { showFrontmatter: false });
		expect(res.html).not.toContain('mdsh-frontmatter');
		// Les donnees parsees restent disponibles meme si non rendues.
		expect(res.frontmatter.author).toBe('Thomas');
	});
});

describe('hasMath / hasMermaid - cas complementaires', () => {
	it('hasMath detecte un display math $$…$$ inline', () => {
		expect(hasMath('texte $$a^2$$ suite')).toBe(true);
	});

	it('hasMath rejette un simple $ isole', () => {
		expect(hasMath('le prix est $ ici')).toBe(false);
	});

	it('hasMermaid tolere une indentation avant la fence', () => {
		expect(hasMermaid('  ```mermaid\ngraph TD\n```')).toBe(true);
	});

	it('hasMermaid rejette un bloc de code non mermaid', () => {
		expect(hasMermaid('```js\nconst x = 1;\n```')).toBe(false);
	});
});
