import { describe, it, expect } from 'vitest';
import {
	slugify,
	escapeRegex,
	preprocessWikiLinks,
	decodeWikiTarget,
	extractWikiLinkTargets
} from './wiki-links';

describe('slugify', () => {
	it('retire les diacritiques (é → e)', () => {
		expect(slugify('Café')).toBe('cafe');
	});

	it('retire les diacritiques composés (à, ü, ñ)', () => {
		expect(slugify('àüñ')).toBe('aun');
	});

	it('convertit en minuscules', () => {
		expect(slugify('Hello World')).toBe('hello-world');
	});

	it('remplace les espaces par des tirets', () => {
		expect(slugify('mon fichier notes')).toBe('mon-fichier-notes');
	});

	it('groupe les caractères non alphanumériques en un seul tiret', () => {
		expect(slugify('a  b--c')).toBe('a-b-c');
	});

	it('retire les tirets en début et fin', () => {
		expect(slugify('  Titre!  ')).toBe('titre');
	});

	it('retourne une chaîne vide pour une entrée vide', () => {
		expect(slugify('')).toBe('');
	});

	it('retourne une chaîne vide pour une entrée composée uniquement de séparateurs', () => {
		expect(slugify('---')).toBe('');
	});

	it('conserve les chiffres', () => {
		expect(slugify('Note 42')).toBe('note-42');
	});

	it('gère un titre avec tirets et majuscules composés', () => {
		expect(slugify('Réunion RH - 2026')).toBe('reunion-rh-2026');
	});
});

describe('escapeRegex', () => {
	it("échappe le point (métacaractère regex '.')", () => {
		expect(escapeRegex('a.b')).toBe('a\\.b');
	});

	it("échappe l'étoile", () => {
		expect(escapeRegex('a*b')).toBe('a\\*b');
	});

	it('échappe les métacaractères courants (+?^${}()|[]\\)', () => {
		const input = '.*+?^${}()|[]\\';
		const escaped = escapeRegex(input);
		// Chaque métacar est préfixé par backslash - on vérifie qu'aucun n'est nu
		expect(() => new RegExp(escaped)).not.toThrow();
		// La regex issue de l'échappement doit correspondre exactement à l'original
		expect(new RegExp(escaped).test(input)).toBe(true);
	});

	it('laisse les caractères ordinaires intacts', () => {
		expect(escapeRegex('hello world')).toBe('hello world');
	});

	it('retourne une chaîne vide sur entrée vide', () => {
		expect(escapeRegex('')).toBe('');
	});
});

describe('preprocessWikiLinks', () => {
	it('transforme [[X]] en lien ancre avec class wiki-link', () => {
		const result = preprocessWikiLinks('Voir [[Notes]]');
		expect(result).toContain('class="wiki-link"');
		expect(result).toContain('href="#mdsh-wiki-notes"');
		expect(result).toContain('>Notes<');
	});

	it("utilise l'alias quand fourni [[X|alias]]", () => {
		const result = preprocessWikiLinks('[[Rapport annuel|Rapport]]');
		expect(result).toContain('>Rapport<');
		expect(result).toContain('href="#mdsh-wiki-rapport-annuel"');
	});

	it('encode la cible dans data-mdsh-wiki via encodeURIComponent', () => {
		const result = preprocessWikiLinks('[[Mon fichier.md]]');
		expect(result).toContain('data-mdsh-wiki="Mon%20fichier.md"');
	});

	it('échappe les caractères HTML dangereux dans le label (anti-XSS [[<script>]])', () => {
		const result = preprocessWikiLinks('[[<script>alert(1)</script>]]');
		expect(result).not.toContain('<script>');
		// Le label doit être échappé
		expect(result).toContain('&lt;script&gt;');
	});

	it("échappe les caractères HTML dans l'alias", () => {
		const result = preprocessWikiLinks('[[Cible|<b>gras</b>]]');
		expect(result).not.toContain('<b>');
		expect(result).toContain('&lt;b&gt;');
	});

	it('encode la cible contenant des chevrons dans data-mdsh-wiki', () => {
		const result = preprocessWikiLinks('[[<hostile>]]');
		// encodeURIComponent('<hostile>') → %3Chostile%3E - pas de < nu dans l'attribut
		expect(result).not.toMatch(/data-mdsh-wiki="[^"]*</);
	});

	it("laisse le markdown intact quand il n'y a pas de wiki-link", () => {
		const md = '# Titre\n\nUn paragraphe.';
		expect(preprocessWikiLinks(md)).toBe(md);
	});

	it('gère plusieurs wiki-links dans la même chaîne', () => {
		const result = preprocessWikiLinks('[[A]] et [[B]]');
		const count = (result.match(/class="wiki-link"/g) ?? []).length;
		expect(count).toBe(2);
	});

	it('ignore les wiki-links sans cible (crochets vides [[]])', () => {
		// Cible vide → non remplacé (retour du match brut)
		const result = preprocessWikiLinks('[[]]');
		expect(result).toBe('[[]]');
	});

	it('accepte une cible avec des espaces avant/après', () => {
		const result = preprocessWikiLinks('[[ Mon Fichier ]]');
		expect(result).toContain('data-mdsh-wiki="Mon%20Fichier"');
	});

	it('ne transforme PAS un wiki-link dans un span de code inline', () => {
		const result = preprocessWikiLinks('Tape `[[Cible]]` pour lier.');
		expect(result).toBe('Tape `[[Cible]]` pour lier.');
		expect(result).not.toContain('wiki-link');
	});

	it('ne transforme PAS un wiki-link dans un bloc de code clôturé', () => {
		const md = 'Avant\n\n```\n[[Cible]]\n```\n\nAprès [[Réel]]';
		const result = preprocessWikiLinks(md);
		// Le `[[Cible]]` du fence reste littéral, le `[[Réel]]` hors code est transformé.
		expect(result).toContain('```\n[[Cible]]\n```');
		expect(result).toContain('data-mdsh-wiki="R%C3%A9el"');
		expect((result.match(/class="wiki-link"/g) ?? []).length).toBe(1);
	});
});

describe('decodeWikiTarget', () => {
	it('décode un encodeURIComponent standard', () => {
		expect(decodeWikiTarget('Mon%20fichier.md')).toBe('Mon fichier.md');
	});

	it('fait un round-trip avec encodeURIComponent', () => {
		const original = 'Réunion 2026 - Rapport final.md';
		const encoded = encodeURIComponent(original);
		expect(decodeWikiTarget(encoded)).toBe(original);
	});

	it('retourne la valeur brute si le décodage échoue (séquence invalide)', () => {
		// '%ZZ' n'est pas un séquence URI valide
		expect(decodeWikiTarget('%ZZ')).toBe('%ZZ');
	});

	it('retourne une chaîne vide sur entrée vide', () => {
		expect(decodeWikiTarget('')).toBe('');
	});

	it('round-trip : une cible avec des chevrons reste intacte', () => {
		const original = '<hostile>';
		expect(decodeWikiTarget(encodeURIComponent(original))).toBe(original);
	});
});

describe('extractWikiLinkTargets', () => {
	it('extrait une cible simple', () => {
		const targets = extractWikiLinkTargets('Voir [[Notes de réunion]]');
		expect(targets).toEqual(['Notes de réunion']);
	});

	it("extrait la cible (sans l'alias) depuis [[X|alias]]", () => {
		const targets = extractWikiLinkTargets('[[Rapport|Voir ici]]');
		expect(targets).toEqual(['Rapport']);
	});

	it('dédoublonne les cibles répétées', () => {
		const md = '[[A]] et [[A]] encore [[A]]';
		const targets = extractWikiLinkTargets(md);
		expect(targets).toEqual(['A']);
	});

	it('extrait plusieurs cibles distinctes', () => {
		const targets = extractWikiLinkTargets('[[A]] [[B]] [[C]]');
		expect(new Set(targets)).toEqual(new Set(['A', 'B', 'C']));
	});

	it('retourne un tableau vide si aucun wiki-link', () => {
		expect(extractWikiLinkTargets('Aucun lien ici.')).toEqual([]);
	});

	it('trim les espaces autour des cibles', () => {
		const targets = extractWikiLinkTargets('[[ Mon Fichier ]]');
		expect(targets).toEqual(['Mon Fichier']);
	});

	it('ignore les wiki-links sans cible (cible vide)', () => {
		const targets = extractWikiLinkTargets('[[]]');
		expect(targets).toEqual([]);
	});
});
