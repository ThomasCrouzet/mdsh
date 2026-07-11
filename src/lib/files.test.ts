import { describe, it, expect, vi } from 'vitest';
import {
	escapeHTML,
	isMarkdownFile,
	normalizeRename,
	stripMdExtension,
	uniqueName
} from './file-utils';
import { computeBrokenLinks } from './broken-links';
import type { FileItem } from './types';

describe('isMarkdownFile', () => {
	it('accepte .md', () => {
		expect(isMarkdownFile({ name: 'hello.md' })).toBe(true);
	});
	it('accepte .markdown', () => {
		expect(isMarkdownFile({ name: 'HELLO.MARKDOWN' })).toBe(true);
	});
	it('accepte .mdx', () => {
		expect(isMarkdownFile({ name: 'hello.mdx' })).toBe(true);
	});
	it('accepte .txt', () => {
		expect(isMarkdownFile({ name: 'hello.txt' })).toBe(true);
	});
	it('accepte text/markdown', () => {
		expect(isMarkdownFile({ name: 'hello', type: 'text/markdown' })).toBe(true);
	});
	it('rejette .png', () => {
		expect(isMarkdownFile({ name: 'hello.png', type: 'image/png' })).toBe(false);
	});
});

describe('uniqueName', () => {
	it('renvoie tel quel si libre', () => {
		expect(uniqueName([], 'note.md')).toBe('note.md');
	});
	it('suffixe (2) en cas de collision', () => {
		expect(uniqueName(['note.md'], 'note.md')).toBe('note (2).md');
	});
	it("incrémente jusqu'au premier libre", () => {
		expect(uniqueName(['note.md', 'note (2).md'], 'note.md')).toBe('note (3).md');
	});
	it('gère les noms sans extension', () => {
		expect(uniqueName(['readme'], 'readme')).toBe('readme (2)');
	});
});

describe('normalizeRename', () => {
	it('ajoute .md si absent', () => {
		expect(normalizeRename('mon-doc')).toBe('mon-doc.md');
	});
	it('garde .markdown', () => {
		expect(normalizeRename('doc.markdown')).toBe('doc.markdown');
	});
	it('tombe sur Untitled.md si vide', () => {
		expect(normalizeRename('   ')).toBe('Untitled.md');
	});
});

describe('stripMdExtension', () => {
	it('enlève .md', () => {
		expect(stripMdExtension('hello.md')).toBe('hello');
	});
	it('enlève .TXT', () => {
		expect(stripMdExtension('hello.TXT')).toBe('hello');
	});
	it("laisse inchangé si pas d'extension connue", () => {
		expect(stripMdExtension('hello.png')).toBe('hello.png');
	});
});

describe('escapeHTML', () => {
	it('échappe les caractères HTML', () => {
		expect(escapeHTML('<img src="x" onerror="alert(1)">')).toBe(
			'&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;'
		);
	});
	it("échappe aussi l'apostrophe", () => {
		expect(escapeHTML("l'ami")).toBe('l&#39;ami');
	});
});

// §6.9 - Couverture du calcul "lien disque cassé". On teste la fonction pure
// `computeBrokenLinks` avec des handles mockés (FSA n'est pas dispo en jsdom).
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
	it('skip les fichiers non liés au disque', async () => {
		const file = makeFile('a', false);
		const getHandleFn = vi.fn();
		const checkHandleFn = vi.fn();
		const updates = await computeBrokenLinks([file], { getHandleFn, checkHandleFn });
		expect(updates).toEqual([]);
		expect(getHandleFn).not.toHaveBeenCalled();
	});

	it('flag brokenLink:true + handleMissing:true si getHandle renvoie null', async () => {
		const file = makeFile('orphan');
		const updates = await computeBrokenLinks([file], {
			getHandleFn: vi.fn().mockResolvedValue(null),
			checkHandleFn: vi.fn()
		});
		expect(updates).toEqual([{ id: 'orphan', brokenLink: true, handleMissing: true }]);
	});

	it("flag brokenLink:true quand checkHandle renvoie 'broken'", async () => {
		const file = makeFile('b');
		const handle = { name: 'b.md' } as unknown as FileSystemFileHandle;
		const updates = await computeBrokenLinks([file], {
			getHandleFn: vi.fn().mockResolvedValue(handle),
			checkHandleFn: vi.fn().mockResolvedValue('broken')
		});
		expect(updates).toEqual([{ id: 'b', brokenLink: true, handleMissing: false }]);
	});

	it("ne flag pas brokenLink quand checkHandle renvoie 'ok'", async () => {
		const file = makeFile('ok');
		const handle = { name: 'ok.md' } as unknown as FileSystemFileHandle;
		const updates = await computeBrokenLinks([file], {
			getHandleFn: vi.fn().mockResolvedValue(handle),
			checkHandleFn: vi.fn().mockResolvedValue('ok')
		});
		expect(updates).toEqual([{ id: 'ok', brokenLink: false, handleMissing: false }]);
	});

	it("ne flag pas brokenLink pour 'permission-needed' (lien valide mais auth requise)", async () => {
		const file = makeFile('perm');
		const handle = {} as unknown as FileSystemFileHandle;
		const updates = await computeBrokenLinks([file], {
			getHandleFn: vi.fn().mockResolvedValue(handle),
			checkHandleFn: vi.fn().mockResolvedValue('permission-needed')
		});
		expect(updates[0]).toEqual({ id: 'perm', brokenLink: false, handleMissing: false });
	});

	it('traite plusieurs fichiers indépendamment', async () => {
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
