import { describe, it, expect } from 'vitest';
import { DEMO_DOCS } from './demo-doc';
import { extractWikiLinkTargets } from './wiki-links';
import { stripMdExtension } from './file-utils';

describe('DEMO_DOCS', () => {
	it('has unique .md file names', () => {
		const names = DEMO_DOCS.map((d) => d.name);
		expect(new Set(names).size).toBe(names.length);
		for (const name of names) expect(name.endsWith('.md')).toBe(true);
	});

	it('targets another demo document by exact name from each wiki link', () => {
		const titles = new Set(DEMO_DOCS.map((d) => stripMdExtension(d.name).toLowerCase()));
		for (const doc of DEMO_DOCS) {
			for (const target of extractWikiLinkTargets(doc.content)) {
				expect(titles.has(target.toLowerCase())).toBe(true);
			}
		}
	});

	it('targets the first document from the two other documents', () => {
		const [welcome, ...rest] = DEMO_DOCS;
		const welcomeTitle = stripMdExtension(welcome!.name).toLowerCase();
		for (const doc of rest) {
			const targets = extractWikiLinkTargets(doc.content).map((t) => t.toLowerCase());
			expect(targets).toContain(welcomeTitle);
		}
	});

	it('does not contain typographic dashes', () => {
		for (const doc of DEMO_DOCS) {
			expect(doc.content).not.toMatch(/[\u2013\u2014]/);
		}
	});
});
