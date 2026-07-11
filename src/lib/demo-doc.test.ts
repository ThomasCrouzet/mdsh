import { describe, it, expect } from 'vitest';
import { DEMO_DOCS } from './demo-doc';
import { extractWikiLinkTargets } from './wiki-links';
import { stripMdExtension } from './file-utils';

describe('DEMO_DOCS', () => {
	it('a des noms de fichiers .md uniques', () => {
		const names = DEMO_DOCS.map((d) => d.name);
		expect(new Set(names).size).toBe(names.length);
		for (const name of names) expect(name.endsWith('.md')).toBe(true);
	});

	it('chaque wiki-link cible un autre document de la démo par son nom exact', () => {
		const titles = new Set(DEMO_DOCS.map((d) => stripMdExtension(d.name).toLowerCase()));
		for (const doc of DEMO_DOCS) {
			for (const target of extractWikiLinkTargets(doc.content)) {
				expect(titles.has(target.toLowerCase())).toBe(true);
			}
		}
	});

	it('le premier document est bien la cible de backlinks des deux autres', () => {
		const [welcome, ...rest] = DEMO_DOCS;
		const welcomeTitle = stripMdExtension(welcome!.name).toLowerCase();
		for (const doc of rest) {
			const targets = extractWikiLinkTargets(doc.content).map((t) => t.toLowerCase());
			expect(targets).toContain(welcomeTitle);
		}
	});

	it('ne contient aucun tiret typographique (convention du depot)', () => {
		for (const doc of DEMO_DOCS) {
			expect(doc.content).not.toMatch(/[–—]/);
		}
	});
});
