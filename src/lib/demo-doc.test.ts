import { describe, it, expect } from 'vitest';
import { DEMO_DOCS } from './demo-doc';
import { extractWikiLinkTargets } from './wiki-links';
import { stripMdExtension } from './file-utils';

describe('DEMO_DOCS', () => {
	it('targets another demo document by exact name from each wiki link', () => {
		const titles = new Set(DEMO_DOCS.map((d) => stripMdExtension(d.name).toLowerCase()));
		for (const doc of DEMO_DOCS) {
			for (const target of extractWikiLinkTargets(doc.content)) {
				expect(titles.has(target.toLowerCase())).toBe(true);
			}
		}
	});
});
