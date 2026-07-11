import { describe, it, expect } from 'vitest';
import { hasMath, hasMermaid, renderMarkdown } from './markdown';

describe('renderMarkdown - markdown de base', () => {
	it('rend un titre H1', async () => {
		const html = await renderMarkdown('# Hello');
		// §B4.5 - Le rendu inclut maintenant un anchor `#` dans h1-h3.
		expect(html).toMatch(/<h1[^>]*id="hello"[^>]*>Hello/);
		expect(html).toContain('class="mdsh-anchor"');
	});

	it('rend des emphases', async () => {
		const html = await renderMarkdown('**gras** et *italique*');
		expect(html).toContain('<strong>gras</strong>');
		expect(html).toContain('<em>italique</em>');
	});

	it('rend un lien', async () => {
		const html = await renderMarkdown('[mdsh](https://example.com)');
		expect(html).toMatch(/<a href="https:\/\/example\.com"[^>]*>mdsh<\/a>/);
	});

	it('rend une liste non ordonnée', async () => {
		const html = await renderMarkdown('- un\n- deux');
		expect(html).toContain('<ul>');
		expect(html).toContain('<li>un</li>');
	});
});

describe('renderMarkdown - GFM', () => {
	it('rend une table', async () => {
		const html = await renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |');
		expect(html).toContain('<table>');
		expect(html).toContain('<th>a</th>');
		expect(html).toContain('<td>1</td>');
	});

	it('rend une checklist', async () => {
		const html = await renderMarkdown('- [ ] à faire\n- [x] fait');
		expect(html).toContain('type="checkbox"');
		expect(html).toMatch(/checked/);
	});

	it('rend strikethrough', async () => {
		const html = await renderMarkdown('~~barré~~');
		expect(html).toContain('<del>barré</del>');
	});
});

describe('renderMarkdown - code blocks', () => {
	it('applique highlight.js sur du JS', async () => {
		const html = await renderMarkdown('```js\nconst x = 1;\n```');
		expect(html).toContain('hljs');
		expect(html).toContain('language-js');
		expect(html).toMatch(/class="hljs-keyword"/);
	});

	it('gère un lang inconnu sans planter', async () => {
		const html = await renderMarkdown('```gibberish\nfoo bar\n```');
		// §B1.9 - `<pre>` porte un aria-label ("Bloc de code" si lang inconnu).
		expect(html).toMatch(/<pre[^>]*aria-label="Bloc de code"/);
		expect(html).toContain('<code');
	});

	it('conserve le code inline', async () => {
		const html = await renderMarkdown('Voir `run()` pour lancer');
		expect(html).toContain('<code>run()</code>');
	});
});

describe('renderMarkdown - math KaTeX', () => {
	it('rend une formule inline', async () => {
		const html = await renderMarkdown('Soit $a^2 + b^2 = c^2$ un théorème');
		expect(html).toContain('katex');
		expect(html).not.toContain('$a^2');
	});

	it('rend une formule block', async () => {
		const html = await renderMarkdown('$$\n\\int_0^1 x\\,dx = \\frac{1}{2}\n$$');
		expect(html).toContain('math-block');
		expect(html).toContain('katex');
	});

	it('ne casse pas sur du TeX invalide', async () => {
		const html = await renderMarkdown('$\\badcommand{}$');
		expect(typeof html).toBe('string');
		expect(html.length).toBeGreaterThan(0);
	});

	it("n'interprète pas un prix comme math ($10)", async () => {
		const html = await renderMarkdown('Prix : $10 - rien à voir');
		expect(html).not.toContain('katex');
		expect(html).toContain('Prix');
	});

	it('coexiste avec les blocs de code', async () => {
		const html = await renderMarkdown('Formule $E = mc^2$\n\n```js\nconst $ = 1;\n```');
		expect(html).toContain('katex');
		expect(html).toContain('hljs');
	});

	it('rend une formule $$…$$ placée en MILIEU de ligne (pas laissée en texte brut)', async () => {
		const html = await renderMarkdown('Voici $$a^2+b^2$$ inline.');
		expect(html).toContain('katex');
		expect(html).not.toContain('$$a^2');
	});
});

describe('hasMath', () => {
	it('détecte inline', () => {
		expect(hasMath('a $x$ b')).toBe(true);
	});
	it('détecte block', () => {
		expect(hasMath('$$\nx\n$$')).toBe(true);
	});
	it('rejette un texte normal', () => {
		expect(hasMath('rien de spécial')).toBe(false);
	});
	it('ne confond pas $10', () => {
		expect(hasMath('prix $10 ici')).toBe(false);
	});
	it('aligné sur le tokenizer : un $ fermant suivi d’un chiffre n’est pas du math', () => {
		// `$x$5` : le tokenizer rejette via `(?!\d)` → hasMath ne doit pas sur-détecter.
		expect(hasMath('$x$5')).toBe(false);
	});
	it('détecte $$…$$ même en milieu de ligne', () => {
		expect(hasMath('texte $$x$$ suite')).toBe(true);
	});
});

describe('hasMermaid', () => {
	it('détecte un bloc mermaid', () => {
		expect(hasMermaid('```mermaid\ngraph TD\n```')).toBe(true);
	});
	it('détecte avec fence ~~~', () => {
		expect(hasMermaid('~~~mermaid\ngraph TD\n~~~')).toBe(true);
	});
	it("rejette si 'mermaid' n'est pas un lang de code block", () => {
		expect(hasMermaid('Voir mermaid en action')).toBe(false);
	});
	it('rejette un langage voisin', () => {
		expect(hasMermaid('```mermaidx\ncontent\n```')).toBe(false);
	});
});

describe('renderMarkdown - extraction Mermaid', () => {
	it('laisse passer le markdown sans bloc mermaid', async () => {
		const html = await renderMarkdown('# Hello\n\ndu texte');
		expect(html).not.toContain('mermaid-block');
		expect(html).not.toContain('MERMAID-');
	});

	// Note: on ne teste pas le rendu SVG effectif en unit test - Mermaid nécessite
	// un DOM complet avec mesure de bounding box. Les tests d'intégration
	// visuelle se font via l'app de dev.
});

describe('renderMarkdown - front-matter (§5.1)', () => {
	it('strippe le bloc YAML en tête du markdown', async () => {
		const md = `---
title: Doc
author: Thomas
---

# Contenu`;
		const html = await renderMarkdown(md);
		expect(html).toContain('<h1');
		expect(html).toContain('Contenu');
		// Le bloc YAML brut ne doit pas apparaître dans le HTML.
		expect(html).not.toContain('---\ntitle');
		expect(html).not.toContain('author: Thomas');
	});

	it('insère un bloc <aside class="mdsh-frontmatter"> avec les métadonnées', async () => {
		const md = `---
title: Doc
author: Thomas
---

corps`;
		const html = await renderMarkdown(md);
		expect(html).toContain('mdsh-frontmatter');
		expect(html).toContain('Thomas');
	});

	it('rend les tags YAML comme chips', async () => {
		const md = `---
tags: [notes, projet-x]
---

corps`;
		const html = await renderMarkdown(md);
		expect(html).toContain('mdsh-frontmatter-tag');
		expect(html).toContain('notes');
		expect(html).toContain('projet-x');
	});

	it('omet le bloc front-matter si showFrontmatter=false', async () => {
		const md = `---
author: Thomas
---

corps`;
		const html = await renderMarkdown(md, { showFrontmatter: false });
		expect(html).not.toContain('mdsh-frontmatter');
	});

	it('échappe les valeurs front-matter pour éviter une injection HTML', async () => {
		const md = `---
author: '<img src=x onerror=alert(1)>'
---

corps`;
		const html = await renderMarkdown(md);
		// La balise <img> doit être échappée (rendue comme texte) - pas
		// d'élément exécutable dans le DOM final.
		expect(html).not.toMatch(/<img\s+[^>]*src=x/i);
		// Le mot "onerror" peut survivre comme texte (ex. "&lt;img onerror=...&gt;")
		// mais pas comme attribut.
		expect(html).not.toMatch(/<\w+[^>]*\sonerror=/i);
	});

	it('rend normalement quand le front-matter est invalide', async () => {
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
	it('transforme [[Cible]] en <a class="wiki-link">', async () => {
		const html = await renderMarkdown('Voir [[Notes]] pour plus.');
		expect(html).toContain('class="wiki-link"');
		// Le data-attr est encodé URI-safe : "Notes" → "Notes" (inchangé sur ASCII).
		expect(html).toContain('data-mdsh-wiki="Notes"');
		expect(html).toContain('>Notes</a>');
	});

	it('transforme [[Cible|Alias]] en lien avec label alias', async () => {
		const html = await renderMarkdown('Voir [[notes-projet|mes notes]] ici.');
		expect(html).toContain('data-mdsh-wiki="notes-projet"');
		expect(html).toContain('>mes notes</a>');
	});

	it('génère un href #mdsh-wiki-{slug}', async () => {
		const html = await renderMarkdown('[[Mon Document]]');
		expect(html).toContain('#mdsh-wiki-mon-document');
	});

	it('échappe les caractères HTML dans le label et encode le data-attr', async () => {
		const html = await renderMarkdown('[[<script>alert(1)</script>]]');
		// La balise <script> ne doit pas être présente sous forme exécutable.
		expect(html).not.toMatch(/<script[^>]*>/i);
		// Le data-attr est encodé URL-safe - préserve la cible sans risquer
		// d'être strippé par DOMPurify (encode `<` `>` en `%3C` `%3E`).
		expect(html).toMatch(/data-mdsh-wiki="[^"]*%3C[^"]*"/i);
	});

	it('ne touche pas un single-bracket [text]', async () => {
		const html = await renderMarkdown('Un [lien](https://example.com)');
		expect(html).not.toContain('wiki-link');
		expect(html).toContain('href="https://example.com"');
	});

	it('gère plusieurs wiki-links dans un même paragraphe', async () => {
		const html = await renderMarkdown('Voir [[A]] et [[B|alias B]].');
		// Compte des occurrences de class="wiki-link"
		const matches = html.match(/class="wiki-link"/g) ?? [];
		expect(matches.length).toBe(2);
	});
});

describe('renderMarkdown - protection tabnabbing (P1.1)', () => {
	it('force rel="noopener noreferrer" sur un lien externe https://', async () => {
		const html = await renderMarkdown('[exemple](https://example.com)');
		// Le lien doit porter à la fois target="_blank" et rel="noopener noreferrer"
		expect(html).toContain('target="_blank"');
		expect(html).toContain('rel="noopener noreferrer"');
	});

	it('force rel="noopener noreferrer" sur un lien externe http://', async () => {
		const html = await renderMarkdown('[insecure](http://example.com)');
		expect(html).toContain('rel="noopener noreferrer"');
	});

	it("force rel sur un <a target='_blank'> injecté en HTML brut", async () => {
		// Scénario : fichier .md hostile importé via drag-drop / share-target
		const html = await renderMarkdown('<a href="https://evil.tld" target="_blank">clic</a>');
		expect(html).toContain('rel="noopener noreferrer"');
	});

	it("n'ajoute pas target/rel sur un lien wiki interne (#mdsh-wiki-...)", async () => {
		// Les wiki-links génèrent href="#mdsh-wiki-<slug>" - ancre locale, pas externe.
		const html = await renderMarkdown('Voir [[Notes]]');
		// Récupère uniquement le <a> du wiki-link (href="#mdsh-wiki-notes")
		const wikiLink = html.match(/<a[^>]+href="#mdsh-wiki-notes"[^>]*>/)?.[0] ?? '';
		expect(wikiLink).toBeTruthy();
		expect(wikiLink).not.toContain('rel="noopener noreferrer"');
		expect(wikiLink).not.toContain('target="_blank"');
	});

	it("n'ajoute pas target/rel sur une ancre locale (#section)", async () => {
		// Les ancres de heading sont des liens internes - ne doivent pas être altérés.
		const html = await renderMarkdown('# Mon titre');
		// L'ancre permalink porte href="#mon-titre"
		const anchor = html.match(/<a[^>]+href="#mon-titre"[^>]*>/)?.[0] ?? '';
		expect(anchor).toBeTruthy();
		expect(anchor).not.toContain('rel="noopener noreferrer"');
	});
});

describe('renderMarkdown - sanitization XSS', () => {
	it('strippe les balises <script>', async () => {
		const html = await renderMarkdown('Avant\n\n<script>alert(1)</script>\n\nAprès');
		expect(html).not.toContain('<script');
		expect(html).not.toContain('alert(1)');
		expect(html).toContain('Avant');
		expect(html).toContain('Après');
	});

	it('retire les attributs onerror / onload / onclick', async () => {
		const html = await renderMarkdown(
			'<img src="x" onerror="alert(1)">\n\n<div onload="alert(2)" onclick="alert(3)">x</div>'
		);
		expect(html).not.toContain('onerror');
		expect(html).not.toContain('onload');
		expect(html).not.toContain('onclick');
		expect(html).not.toMatch(/alert\(\d\)/);
	});

	it('strippe les href="javascript:..."', async () => {
		const html = await renderMarkdown('[clic](javascript:alert(1))');
		expect(html).not.toContain('javascript:');
		expect(html).not.toContain('alert(1)');
	});

	it('strippe les <iframe>', async () => {
		const html = await renderMarkdown('<iframe src="https://evil.tld"></iframe>\n\nOK');
		expect(html).not.toContain('<iframe');
		expect(html).not.toContain('evil.tld');
		expect(html).toContain('OK');
	});

	it('strippe <object>, <embed> et <form>', async () => {
		const html = await renderMarkdown(
			'<object data="x.swf"></object>\n<embed src="x">\n<form action="//evil"><input name=pw></form>'
		);
		expect(html).not.toContain('<object');
		expect(html).not.toContain('<embed');
		expect(html).not.toContain('<form');
	});

	it('conserve les liens https:// légitimes', async () => {
		const html = await renderMarkdown('[ok](https://example.com/path)');
		expect(html).toContain('href="https://example.com/path"');
	});

	it('préserve les task lists GFM après sanitization', async () => {
		const html = await renderMarkdown('- [ ] todo\n- [x] done');
		expect(html).toContain('type="checkbox"');
		expect(html).toMatch(/checked/);
	});

	it('préserve le rendu KaTeX après sanitization', async () => {
		const html = await renderMarkdown('$a^2 + b^2 = c^2$');
		expect(html).toContain('katex');
	});
});
