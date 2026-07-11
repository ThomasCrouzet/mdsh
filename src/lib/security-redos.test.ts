// §J2 - Garde anti-ReDoS sur les parsers regex exposés à du contenu hostile.
//
// L'app parse du markdown importé (drag-drop, share_target, launchQueue, ouverture
// disque) qui peut être adverse. Plusieurs regex combinent quantificateurs
// non-greedy et alternations - terrain classique du « catastrophic backtracking »
// (un fichier piégé fige l'onglet → déni de service côté client).
//
// Deux niveaux :
//   1. Régression déterministe : entrées pathologiques connues, plafond de temps
//      large (1 s). Un backtracking catastrophique prend des dizaines de secondes ;
//      un parsing linéaire reste < 1 ms même sur 100k caractères → le plafond
//      distingue les deux sans flakiness CI.
//   2. Fuzzing (fast-check) : chaînes faites des métacaractères qui stressent les
//      regex. Une explosion fait dépasser le timeout du test → échec visible.

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

describe('anti-ReDoS - entrées pathologiques (régression)', () => {
	// Candidat n°1 : le tokenizer math combine `\\$|[^\n$]` (+?) → ambiguïté sur `\`.
	it('hasMath : avalanche de backslashes non terminée', () => {
		expect(elapsed(() => hasMath('$' + '\\'.repeat(100_000)))).toBeLessThan(1000);
	});
	it('hasMath : $ ouvrant + corps massif sans fermeture', () => {
		expect(elapsed(() => hasMath('$' + 'a'.repeat(100_000)))).toBeLessThan(1000);
	});
	it('hasMath : alternance de $ partiels', () => {
		expect(elapsed(() => hasMath('$a'.repeat(50_000)))).toBeLessThan(1000);
	});
	it('hasMermaid : fences en rafale', () => {
		expect(elapsed(() => hasMermaid('```'.repeat(50_000)))).toBeLessThan(1000);
	});
	it('preprocessWikiLinks : crochets ouvrants en rafale', () => {
		expect(elapsed(() => preprocessWikiLinks('[['.repeat(50_000)))).toBeLessThan(1000);
	});
	it('preprocessWikiLinks : cible non fermée massive', () => {
		expect(elapsed(() => preprocessWikiLinks('[[' + 'a'.repeat(100_000)))).toBeLessThan(1000);
	});
	it('extractWikiLinkTargets : pipes et crochets mêlés', () => {
		expect(elapsed(() => extractWikiLinkTargets('[[a|'.repeat(50_000)))).toBeLessThan(1000);
	});
	it('stripFrontmatter : bloc --- jamais fermé', () => {
		expect(elapsed(() => stripFrontmatter('---\n' + 'a\n'.repeat(100_000)))).toBeLessThan(1000);
	});
	it('slugify : entrée massive avec diacritiques', () => {
		expect(elapsed(() => slugify('Éà-'.repeat(100_000)))).toBeLessThan(1000);
	});
});

describe('anti-ReDoS - fuzzing métacaractères (fast-check)', () => {
	// Chaînes composées des délimiteurs qui stressent les regex math/wiki/frontmatter.
	const meta = fc
		.array(fc.constantFrom('$', '\\', '[', ']', '|', '-', '`', '\n', 'x'), { maxLength: 1500 })
		.map((chars) => chars.join(''));

	it('aucun parser n’explose sur des entrées adversariales', { timeout: 10_000 }, () => {
		fc.assert(
			fc.property(meta, (s) => {
				// Une explosion ferait dépasser le timeout (déclaré ci-dessus) → échec.
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

	it('slugify : sortie toujours dans [a-z0-9-], sans tiret en bord', () => {
		fc.assert(
			fc.property(fc.string(), (s) => {
				const out = slugify(s);
				return /^[a-z0-9-]*$/.test(out) && !out.startsWith('-') && !out.endsWith('-');
			}),
			{ numRuns: 500 }
		);
	});

	it('preprocessWikiLinks : neutre sur du texte sans [[…]]', () => {
		fc.assert(
			fc.property(
				fc.string().filter((s) => !s.includes('[[')),
				(s) => preprocessWikiLinks(s) === s
			),
			{ numRuns: 300 }
		);
	});
});

describe("§J2 - bombe d'alias YAML en front-matter (DoS)", () => {
	// Une bombe d'alias YAML produit un GRAPHE partagé compact, mais le
	// stringifier comme un ARBRE explose exponentiellement. Le rendu du bloc
	// front-matter (buildFrontmatterBlock) ne doit jamais expanser ce graphe.
	it("rend en moins d'une seconde avec une sortie bornée", async () => {
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
		// Sans borne, String() traverserait ~9^6 noeuds -> plusieurs Mo / secondes.
		expect(ms).toBeLessThan(1000);
		expect(html.length).toBeLessThan(50_000);
	});
});
