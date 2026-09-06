import { describe, it, expect, vi } from 'vitest';
import {
	escapeHTML,
	isMarkdownFile,
	normalizeRename,
	stripMdExtension,
	uniqueName,
	untitledFilename
} from './file-utils';
import { i18n } from '$lib/i18n';
import { computeBrokenLinks } from './broken-links';
import type { FileItem } from './types';

describe('isMarkdownFile', () => {
	it('accepts .md', () => {
		expect(isMarkdownFile({ name: 'hello.md' })).toBe(true);
	});
	it('accepts .markdown', () => {
		expect(isMarkdownFile({ name: 'HELLO.MARKDOWN' })).toBe(true);
	});
	it('accepts .mdx', () => {
		expect(isMarkdownFile({ name: 'hello.mdx' })).toBe(true);
	});
	it('accepts .txt', () => {
		expect(isMarkdownFile({ name: 'hello.txt' })).toBe(true);
	});
	it('accepts text/markdown', () => {
		expect(isMarkdownFile({ name: 'hello', type: 'text/markdown' })).toBe(true);
	});
	it('rejette .png', () => {
		expect(isMarkdownFile({ name: 'hello.png', type: 'image/png' })).toBe(false);
	});
});

describe('uniqueName', () => {
	it('returns an available name unchanged', () => {
		expect(uniqueName([], 'note.md')).toBe('note.md');
	});
	it('adds a (2) suffix after a collision', () => {
		expect(uniqueName(['note.md'], 'note.md')).toBe('note (2).md');
	});
	it('increments until it finds an available name', () => {
		expect(uniqueName(['note.md', 'note (2).md'], 'note.md')).toBe('note (3).md');
	});
	it('supports names without an extension', () => {
		expect(uniqueName(['readme'], 'readme')).toBe('readme (2)');
	});
});

describe('normalizeRename', () => {
	it('adds .md when it is missing', () => {
		expect(normalizeRename('mon-doc')).toBe('mon-doc.md');
	});
	it('keeps .markdown', () => {
		expect(normalizeRename('doc.markdown')).toBe('doc.markdown');
	});
	it('uses the current locale untitled name for an empty value', () => {
		const prev = i18n.locale;
		i18n.locale = 'fr';
		expect(normalizeRename('   ')).toBe(untitledFilename());
		expect(normalizeRename('   ')).toBe('Sans titre.md');
		i18n.locale = 'en';
		expect(normalizeRename('   ')).toBe('Untitled.md');
		i18n.locale = prev;
	});
});

describe('stripMdExtension', () => {
	it('removes .md', () => {
		expect(stripMdExtension('hello.md')).toBe('hello');
	});
	it('removes .TXT', () => {
		expect(stripMdExtension('hello.TXT')).toBe('hello');
	});
	it('keeps a name without a known extension', () => {
		expect(stripMdExtension('hello.png')).toBe('hello.png');
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

// §6.9 - Test broken disk link detection through the pure `computeBrokenLinks`
// function and mocked handles. jsdom does not provide the FSA API.
function makeFile(id: string, linkedToDisk = true): FileItem {
	return {
		id,
		name: `${id}.md`,
		content: '',
		createdAt: 0,
		updatedAt: 0,
		dirty: false,
		linkedToDisk
	};
}

describe('computeBrokenLinks', () => {
	it('skips files that are not linked to disk', async () => {
		const file = makeFile('a', false);
		const getHandleFn = vi.fn();
		const checkHandleFn = vi.fn();
		const updates = await computeBrokenLinks([file], { getHandleFn, checkHandleFn });
		expect(updates).toEqual([]);
		expect(getHandleFn).not.toHaveBeenCalled();
	});

	it('sets brokenLink and handleMissing when getHandle returns null', async () => {
		const file = makeFile('orphan');
		const updates = await computeBrokenLinks([file], {
			getHandleFn: vi.fn().mockResolvedValue(null),
			checkHandleFn: vi.fn()
		});
		expect(updates).toEqual([{ id: 'orphan', brokenLink: true, handleMissing: true }]);
	});

	it('sets brokenLink when checkHandle returns broken', async () => {
		const file = makeFile('b');
		const handle = { name: 'b.md' } as unknown as FileSystemFileHandle;
		const updates = await computeBrokenLinks([file], {
			getHandleFn: vi.fn().mockResolvedValue(handle),
			checkHandleFn: vi.fn().mockResolvedValue('broken')
		});
		expect(updates).toEqual([{ id: 'b', brokenLink: true, handleMissing: false }]);
	});

	it('does not set brokenLink when checkHandle returns ok', async () => {
		const file = makeFile('ok');
		const handle = { name: 'ok.md' } as unknown as FileSystemFileHandle;
		const updates = await computeBrokenLinks([file], {
			getHandleFn: vi.fn().mockResolvedValue(handle),
			checkHandleFn: vi.fn().mockResolvedValue('ok')
		});
		expect(updates).toEqual([{ id: 'ok', brokenLink: false, handleMissing: false }]);
	});

	it('does not set brokenLink when permission is required', async () => {
		const file = makeFile('perm');
		const handle = {} as unknown as FileSystemFileHandle;
		const updates = await computeBrokenLinks([file], {
			getHandleFn: vi.fn().mockResolvedValue(handle),
			checkHandleFn: vi.fn().mockResolvedValue('permission-needed')
		});
		expect(updates[0]).toEqual({ id: 'perm', brokenLink: false, handleMissing: false });
	});

	it('processes multiple files independently', async () => {
		const a = makeFile('a');
		const b = makeFile('b');
		const c = makeFile('c', false);
		const handleA = { name: 'a' } as unknown as FileSystemFileHandle;
		const handleB = { name: 'b' } as unknown as FileSystemFileHandle;
		const updates = await computeBrokenLinks([a, b, c], {
			getHandleFn: vi
				.fn()
				.mockImplementation(async (id: string) =>
					id === 'a' ? handleA : id === 'b' ? handleB : null
				),
			checkHandleFn: vi.fn().mockResolvedValueOnce('ok').mockResolvedValueOnce('broken')
		});
		expect(updates).toEqual([
			{ id: 'a', brokenLink: false, handleMissing: false },
			{ id: 'b', brokenLink: true, handleMissing: false }
		]);
	});
});
