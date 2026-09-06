import { describe, it, expect } from 'vitest';
import {
	isPathLinkRecord,
	pathBasename,
	isMarkdownDiskPath,
	ensureMarkdownDiskPath,
	pathLinkRecord
} from './disk-link';

describe('isPathLinkRecord', () => {
	it('accepts a valid path record', () => {
		expect(isPathLinkRecord({ kind: 'path', path: '/tmp/a.md' })).toBe(true);
	});

	it('rejects an FSA handle and invalid objects', () => {
		expect(isPathLinkRecord({})).toBe(false);
		expect(isPathLinkRecord({ kind: 'path', path: '' })).toBe(false);
		expect(isPathLinkRecord(null)).toBe(false);
		expect(isPathLinkRecord('x')).toBe(false);
	});
});

describe('pathBasename', () => {
	it('gets the last POSIX segment', () => {
		expect(pathBasename('/Users/me/notes/hello.md')).toBe('hello.md');
	});

	it('gets the last Windows segment', () => {
		expect(pathBasename('C:\\Users\\me\\notes\\hello.md')).toBe('hello.md');
	});

	it('returns the full path when it has no separator', () => {
		expect(pathBasename('solo.md')).toBe('solo.md');
	});
});

describe('isMarkdownDiskPath', () => {
	it('accepts md, markdown, mdx, and txt extensions', () => {
		expect(isMarkdownDiskPath('/a/b.md')).toBe(true);
		expect(isMarkdownDiskPath('C:\\x\\y.markdown')).toBe(true);
		expect(isMarkdownDiskPath('z.MDX')).toBe(true);
		expect(isMarkdownDiskPath('n.txt')).toBe(true);
	});

	it('rejects other extensions', () => {
		expect(isMarkdownDiskPath('/a/b.pdf')).toBe(false);
		expect(isMarkdownDiskPath('/a/b')).toBe(false);
	});
});

describe('pathLinkRecord', () => {
	it('creates a record for IndexedDB storage', () => {
		expect(pathLinkRecord('/tmp/x.md')).toEqual({ kind: 'path', path: '/tmp/x.md' });
	});
});

describe('ensureMarkdownDiskPath', () => {
	it('keeps a path with an allowed Markdown extension', () => {
		expect(ensureMarkdownDiskPath('/tmp/note.md')).toBe('/tmp/note.md');
		expect(ensureMarkdownDiskPath('/tmp/note.markdown')).toBe('/tmp/note.markdown');
		expect(ensureMarkdownDiskPath('C:\\notes\\a.txt')).toBe('C:\\notes\\a.txt');
	});

	it('adds .md when the dialog returns a name without an extension', () => {
		expect(ensureMarkdownDiskPath('/tmp/note')).toBe('/tmp/note.md');
		expect(ensureMarkdownDiskPath('/Users/me/Draft')).toBe('/Users/me/Draft.md');
	});

	it('adds .md after a disallowed extension', () => {
		// Save dialog filters already restrict, but a bare weird path still needs a writeable ext.
		expect(ensureMarkdownDiskPath('/tmp/x.pdf')).toBe('/tmp/x.pdf.md');
	});
});
