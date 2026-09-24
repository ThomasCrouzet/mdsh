import { describe, it, expect } from 'vitest';
import { escapeHTML, uniqueName } from './file-utils';

describe('uniqueName', () => {
	it('increments until it finds an available name', () => {
		expect(uniqueName(['note.md', 'note (2).md'], 'note.md')).toBe('note (3).md');
	});
	it('supports names without an extension', () => {
		expect(uniqueName(['readme'], 'readme')).toBe('readme (2)');
	});
});

describe('escapeHTML', () => {
	it('escapes HTML characters', () => {
		expect(escapeHTML('<img src="x" onerror="alert(1)">')).toBe(
			'&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;'
		);
	});
	it('also escapes apostrophes', () => {
		expect(escapeHTML("l'ami")).toBe('l&#39;ami');
	});
});
