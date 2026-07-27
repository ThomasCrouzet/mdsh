import { describe, it, expect } from 'vitest';
import {
	isPathLinkRecord,
	pathBasename,
	isMarkdownDiskPath,
	ensureMarkdownDiskPath,
	pathLinkRecord
} from './disk-link';

describe('isPathLinkRecord', () => {
	it('accepte un enregistrement path valide', () => {
		expect(isPathLinkRecord({ kind: 'path', path: '/tmp/a.md' })).toBe(true);
	});

	it('rejette un handle FSA ou un objet invalide', () => {
		expect(isPathLinkRecord({})).toBe(false);
		expect(isPathLinkRecord({ kind: 'path', path: '' })).toBe(false);
		expect(isPathLinkRecord(null)).toBe(false);
		expect(isPathLinkRecord('x')).toBe(false);
	});
});

describe('pathBasename', () => {
	it('extrait le dernier segment POSIX', () => {
		expect(pathBasename('/Users/me/notes/hello.md')).toBe('hello.md');
	});

	it('extrait le dernier segment Windows', () => {
		expect(pathBasename('C:\\Users\\me\\notes\\hello.md')).toBe('hello.md');
	});

	it('retourne le path entier s il n y a pas de separateur', () => {
		expect(pathBasename('solo.md')).toBe('solo.md');
	});
});

describe('isMarkdownDiskPath', () => {
	it('accepte md markdown mdx txt', () => {
		expect(isMarkdownDiskPath('/a/b.md')).toBe(true);
		expect(isMarkdownDiskPath('C:\\x\\y.markdown')).toBe(true);
		expect(isMarkdownDiskPath('z.MDX')).toBe(true);
		expect(isMarkdownDiskPath('n.txt')).toBe(true);
	});

	it('rejette les autres extensions', () => {
		expect(isMarkdownDiskPath('/a/b.pdf')).toBe(false);
		expect(isMarkdownDiskPath('/a/b')).toBe(false);
	});
});

describe('pathLinkRecord', () => {
	it('construit le record stockable en IDB', () => {
		expect(pathLinkRecord('/tmp/x.md')).toEqual({ kind: 'path', path: '/tmp/x.md' });
	});
});

describe('ensureMarkdownDiskPath', () => {
	it('laisse intact un path avec extension markdown autorisee', () => {
		expect(ensureMarkdownDiskPath('/tmp/note.md')).toBe('/tmp/note.md');
		expect(ensureMarkdownDiskPath('/tmp/note.markdown')).toBe('/tmp/note.markdown');
		expect(ensureMarkdownDiskPath('C:\\notes\\a.txt')).toBe('C:\\notes\\a.txt');
	});

	it('ajoute .md quand le dialogue renvoie un nom sans extension', () => {
		expect(ensureMarkdownDiskPath('/tmp/note')).toBe('/tmp/note.md');
		expect(ensureMarkdownDiskPath('/Users/me/Draft')).toBe('/Users/me/Draft.md');
	});

	it('ajoute .md pour une extension non autorisee (pdf)', () => {
		// Save dialog filters already restrict, but a bare weird path still needs a writeable ext.
		expect(ensureMarkdownDiskPath('/tmp/x.pdf')).toBe('/tmp/x.pdf.md');
	});
});
