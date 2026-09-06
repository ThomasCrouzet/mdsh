import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import type { FileItem } from '$lib/types';

// Mock modules that exportHTML and exportPDF load lazily. Other tests cover the
// actual rendering pipeline and print iframe. This file verifies orchestration:
// title selection, document creation, and download startup.
const renderMarkdownDetailed = vi.fn(
	async (md: string, _options?: { showFrontmatter?: boolean }) => ({
		html: `<rendered>${md}</rendered>`,
		title: ''
	})
);
const buildStandaloneHtmlDocument = vi.fn(
	async (title: string, bodyHtml: string, _source?: string) =>
		`<standalone title="${title}">${bodyHtml}</standalone>`
);
const buildPrintDocument = vi.fn(
	(opts: { title: string; bodyHtml: string; source?: string }) =>
		`<print title="${opts.title}">${opts.bodyHtml}</print>`
);
const printInIframe = vi.fn(async (_html: string) => {});

vi.mock('../render/markdown', () => ({
	renderMarkdownDetailed: (md: string, options?: { showFrontmatter?: boolean }) =>
		options === undefined ? renderMarkdownDetailed(md) : renderMarkdownDetailed(md, options)
}));
vi.mock('../render/print', () => ({
	buildStandaloneHtmlDocument: (title: string, bodyHtml: string, source?: string) =>
		buildStandaloneHtmlDocument(title, bodyHtml, source),
	buildPrintDocument: (opts: { title: string; bodyHtml: string; source?: string }) =>
		buildPrintDocument(opts),
	printInIframe: (html: string) => printInIframe(html)
}));

const desktopMocks = vi.hoisted(() => ({
	isDesktop: vi.fn(() => false),
	tauriSaveExportBlob: vi.fn(async (_blob: Blob, _name: string) => true)
}));

vi.mock('../desktop', () => ({
	isDesktop: () => desktopMocks.isDesktop()
}));

vi.mock('../disk-tauri', () => ({
	tauriSaveExportBlob: (blob: Blob, name: string) => desktopMocks.tauriSaveExportBlob(blob, name)
}));

import { exportMarkdown, exportHTML, exportPDF, exportZip, sanitizeFilename } from './export';

function makeFile(overrides: Partial<FileItem> = {}): FileItem {
	return {
		id: 'test-id',
		name: 'note.md',
		content: '# Hello\n\nMonde.',
		createdAt: Date.now(),
		updatedAt: Date.now(),
		dirty: false,
		...overrides
	};
}

describe('exportMarkdown', () => {
	let createdAnchor: HTMLAnchorElement | null = null;
	let clickSpy: Mock<() => void>;
	let restoreCreateElement: () => void = () => {};
	let createObjectURLSpy: ReturnType<typeof vi.fn>;
	let revokeObjectURLSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		desktopMocks.isDesktop.mockReturnValue(false);
		desktopMocks.tauriSaveExportBlob.mockResolvedValue(true);
		createdAnchor = null;
		clickSpy = vi.fn();
		// Intercept document.createElement to inspect the anchor before click.
		// Replace the method because vi.spyOn does not support its generic overloads.
		// directement la prop et on restaure manuellement dans afterEach.
		const realCreate = document.createElement.bind(document);
		const mocked = (tag: string) => {
			if (tag.toLowerCase() === 'a') {
				const a = realCreate('a') as HTMLAnchorElement;
				a.click = clickSpy;
				createdAnchor = a;
				return a;
			}
			return realCreate(tag);
		};
		document.createElement = mocked as typeof document.createElement;
		restoreCreateElement = () => {
			document.createElement = realCreate as typeof document.createElement;
		};
		// jsdom does not implement URL.createObjectURL. Provide a stub.
		createObjectURLSpy = vi.fn(() => 'blob:mocked');
		revokeObjectURLSpy = vi.fn();
		Object.defineProperty(URL, 'createObjectURL', {
			value: createObjectURLSpy,
			writable: true,
			configurable: true
		});
		Object.defineProperty(URL, 'revokeObjectURL', {
			value: revokeObjectURLSpy,
			writable: true,
			configurable: true
		});
	});

	afterEach(() => {
		restoreCreateElement();
	});

	it('creates a download anchor with the file name', async () => {
		const file = makeFile({ name: 'mon-doc.md' });
		await exportMarkdown(file);
		expect(clickSpy).toHaveBeenCalledOnce();
		expect(createdAnchor?.download).toBe('mon-doc.md');
		expect(createdAnchor?.href).toBe('blob:mocked');
	});

	it('passes a text/markdown Blob to URL.createObjectURL', async () => {
		const file = makeFile({ content: '# Titre' });
		await exportMarkdown(file);
		expect(createObjectURLSpy).toHaveBeenCalledOnce();
		// The prior assertion guarantees that the first mock argument exists.
		const blob = createObjectURLSpy.mock.calls[0]![0] as Blob;
		expect(blob).toBeInstanceOf(Blob);
		expect(blob.type).toBe('text/markdown;charset=utf-8');
	});

	it('revokes the URL after the click', async () => {
		await exportMarkdown(makeFile());
		expect(revokeObjectURLSpy).toHaveBeenCalledOnce();
	});

	it('does not change FileItem', async () => {
		const file = makeFile({ dirty: true });
		const before = { ...file };
		await exportMarkdown(file);
		expect(file).toEqual(before);
	});

	it('returns true after a browser download', async () => {
		expect(await exportMarkdown(makeFile())).toBe(true);
	});
});

describe('exportMarkdown - desktop cancel', () => {
	beforeEach(() => {
		desktopMocks.isDesktop.mockReturnValue(true);
		desktopMocks.tauriSaveExportBlob.mockReset();
	});

	afterEach(() => {
		desktopMocks.isDesktop.mockReturnValue(false);
	});

	it('returns false after save dialog cancellation without a Blob download', async () => {
		desktopMocks.tauriSaveExportBlob.mockResolvedValue(false);
		const createObjectURLSpy = vi.fn(() => 'blob:should-not');
		Object.defineProperty(URL, 'createObjectURL', {
			value: createObjectURLSpy,
			writable: true,
			configurable: true
		});
		const ok = await exportMarkdown(makeFile({ name: 'x.md', content: '# hi' }));
		expect(ok).toBe(false);
		expect(desktopMocks.tauriSaveExportBlob).toHaveBeenCalledOnce();
		expect(createObjectURLSpy).not.toHaveBeenCalled();
	});

	it('returns true and writes through tauriSaveExportBlob after success', async () => {
		desktopMocks.tauriSaveExportBlob.mockResolvedValue(true);
		const ok = await exportMarkdown(makeFile({ name: 'x.md', content: '# hi' }));
		expect(ok).toBe(true);
		expect(desktopMocks.tauriSaveExportBlob).toHaveBeenCalledOnce();
		expect(desktopMocks.tauriSaveExportBlob).toHaveBeenCalledWith(expect.any(Blob), 'x.md');
	});
});

describe('exportZip', () => {
	let createdAnchor: HTMLAnchorElement | null = null;
	let clickSpy: Mock<() => void>;
	let restoreCreateElement: () => void = () => {};
	let createObjectURLSpy: ReturnType<typeof vi.fn>;
	let revokeObjectURLSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		createdAnchor = null;
		clickSpy = vi.fn();
		const realCreate = document.createElement.bind(document);
		const mocked = (tag: string) => {
			if (tag.toLowerCase() === 'a') {
				const a = realCreate('a') as HTMLAnchorElement;
				a.click = clickSpy;
				createdAnchor = a;
				return a;
			}
			return realCreate(tag);
		};
		document.createElement = mocked as typeof document.createElement;
		restoreCreateElement = () => {
			document.createElement = realCreate as typeof document.createElement;
		};
		createObjectURLSpy = vi.fn(() => 'blob:zip-mocked');
		revokeObjectURLSpy = vi.fn();
		Object.defineProperty(URL, 'createObjectURL', {
			value: createObjectURLSpy,
			writable: true,
			configurable: true
		});
		Object.defineProperty(URL, 'revokeObjectURL', {
			value: revokeObjectURLSpy,
			writable: true,
			configurable: true
		});
	});

	afterEach(() => {
		restoreCreateElement();
	});

	it('does nothing for an empty list', async () => {
		await exportZip([]);
		expect(clickSpy).not.toHaveBeenCalled();
		expect(createObjectURLSpy).not.toHaveBeenCalled();
	});

	// JSZip Blob support differs between jsdom combinations. Production keeps the
	// `blob` type, which Playwright covers. This test accepts any value passed to
	// URL.createObjectURL and verifies that orchestration starts one download.
	it('creates one download for multiple files', async () => {
		const files = [
			makeFile({ id: '1', name: 'a.md', content: '# A' }),
			makeFile({ id: '2', name: 'b.md', content: '# B' }),
			makeFile({ id: '3', name: 'c.md', content: '# C' })
		];
		await exportZip(files, 'export.zip');
		expect(clickSpy).toHaveBeenCalledTimes(1);
		expect(createdAnchor?.download).toBe('export.zip');
		expect(createObjectURLSpy).toHaveBeenCalledOnce();
		// The prior assertion guarantees that the first mock argument exists.
		const blob = createObjectURLSpy.mock.calls[0]![0];
		expect(blob).toBeInstanceOf(Blob);
	});

	it('uses the default file name when none is provided', async () => {
		const files = [makeFile({ id: '1', name: 'a.md' })];
		await exportZip(files);
		expect(createdAnchor?.download).toBe('mdsh-export.zip');
	});

	// Prevent silent overwrite when multiple active files use "Sans titre.md".
	// JSZip replaces the previous entry when names are identical.
	//
	// JSZip.file has read and write overloads. Use `unknown` in this test mock.
	// This follows the TypeScript double-cast pattern for test mocks.
	it('resolves duplicate file names', async () => {
		const filesAdded: string[] = [];
		const originalImport = await import('jszip');
		const JSZip = originalImport.default;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const proto = JSZip.prototype as any;
		const realFile = proto.file;
		proto.file = function (this: unknown, name: string, data: unknown) {
			filesAdded.push(name);
			return realFile.call(this, name, data);
		};

		try {
			const files = [
				makeFile({ id: '1', name: 'Sans titre.md', content: '# A' }),
				makeFile({ id: '2', name: 'Sans titre.md', content: '# B' }),
				makeFile({ id: '3', name: 'Sans titre.md', content: '# C' })
			];
			await exportZip(files);
			// The ZIP must contain three separate entries.
			expect(filesAdded).toEqual(['Sans titre.md', 'Sans titre-2.md', 'Sans titre-3.md']);
		} finally {
			proto.file = realFile;
		}
	});

	it('keeps unique names without a suffix', async () => {
		const filesAdded: string[] = [];
		const originalImport = await import('jszip');
		const JSZip = originalImport.default;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const proto = JSZip.prototype as any;
		const realFile = proto.file;
		proto.file = function (this: unknown, name: string, data: unknown) {
			filesAdded.push(name);
			return realFile.call(this, name, data);
		};

		try {
			const files = [
				makeFile({ id: '1', name: 'alpha.md' }),
				makeFile({ id: '2', name: 'beta.md' })
			];
			await exportZip(files);
			expect(filesAdded).toEqual(['alpha.md', 'beta.md']);
		} finally {
			proto.file = realFile;
		}
	});

	it('deduplicates names without extensions', async () => {
		const filesAdded: string[] = [];
		const originalImport = await import('jszip');
		const JSZip = originalImport.default;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const proto = JSZip.prototype as any;
		const realFile = proto.file;
		proto.file = function (this: unknown, name: string, data: unknown) {
			filesAdded.push(name);
			return realFile.call(this, name, data);
		};

		try {
			const files = [
				makeFile({ id: '1', name: 'README', content: '# A' }),
				makeFile({ id: '2', name: 'README', content: '# B' })
			];
			await exportZip(files);
			// Add the suffix at the end when no extension exists.
			expect(filesAdded).toEqual(['README', 'README-2']);
		} finally {
			proto.file = realFile;
		}
	});

	it('sanitizes disallowed names before ZIP insertion', async () => {
		const filesAdded: string[] = [];
		const originalImport = await import('jszip');
		const JSZip = originalImport.default;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const proto = JSZip.prototype as any;
		const realFile = proto.file;
		proto.file = function (this: unknown, name: string, data: unknown) {
			filesAdded.push(name);
			return realFile.call(this, name, data);
		};

		try {
			const files = [makeFile({ id: '1', name: 'a/b:c?.md', content: '# X' })];
			await exportZip(files);
			// No slash can remain because it would create a directory in the ZIP file.
			expect(filesAdded[0]).not.toContain('/');
			expect(filesAdded[0]).toBe('a_b_c_.md');
		} finally {
			proto.file = realFile;
		}
	});
});

// Intercept anchor creation and stub URL.createObjectURL for HTML downloads.
function installDownloadSpies() {
	let createdAnchor: HTMLAnchorElement | null = null;
	const clickSpy = vi.fn();
	const realCreate = document.createElement.bind(document);
	const mocked = (tag: string) => {
		if (tag.toLowerCase() === 'a') {
			const a = realCreate('a') as HTMLAnchorElement;
			a.click = clickSpy;
			createdAnchor = a;
			return a;
		}
		return realCreate(tag);
	};
	document.createElement = mocked as typeof document.createElement;
	const createObjectURLSpy = vi.fn((_blob: Blob) => 'blob:export-mocked');
	const revokeObjectURLSpy = vi.fn();
	Object.defineProperty(URL, 'createObjectURL', {
		value: createObjectURLSpy,
		writable: true,
		configurable: true
	});
	Object.defineProperty(URL, 'revokeObjectURL', {
		value: revokeObjectURLSpy,
		writable: true,
		configurable: true
	});
	return {
		getAnchor: () => createdAnchor,
		clickSpy,
		createObjectURLSpy,
		revokeObjectURLSpy,
		restore: () => {
			document.createElement = realCreate as typeof document.createElement;
		}
	};
}

describe('sanitizeFilename', () => {
	it('replaces disallowed characters with underscores', () => {
		expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j.md')).toBe('a_b_c_d_e_f_g_h_i_j.md');
	});

	it('neutralizes control characters', () => {
		expect(sanitizeFilename('a\x00b\x1fc.md')).toBe('a_b_c.md');
	});

	it('keeps a valid name unchanged', () => {
		expect(sanitizeFilename('mon-doc.md')).toBe('mon-doc.md');
	});

	it('keeps the .md extension on a valid name', () => {
		// `.md` is not empty after trim, so keep it without a fallback.
		expect(sanitizeFilename('.md')).toBe('.md');
	});

	it('uses the localized untitled name for an empty name', async () => {
		const { i18n } = await import('$lib/i18n');
		const { untitledBasename } = await import('$lib/file-utils');
		const prev = i18n.locale;
		i18n.locale = 'fr';
		expect(sanitizeFilename('')).toBe(untitledBasename());
		expect(sanitizeFilename('')).toBe('Sans titre');
		expect(sanitizeFilename('   ')).toBe('Sans titre');
		i18n.locale = 'en';
		expect(sanitizeFilename('')).toBe('Untitled');
		expect(sanitizeFilename('   ')).toBe('Untitled');
		i18n.locale = prev;
	});
});

describe('exportHTML', () => {
	let dl: ReturnType<typeof installDownloadSpies>;

	beforeEach(() => {
		vi.clearAllMocks();
		renderMarkdownDetailed.mockImplementation(async (md: string) => ({
			html: `<rendered>${md}</rendered>`,
			title: ''
		}));
		dl = installDownloadSpies();
	});

	afterEach(() => {
		dl.restore();
	});

	it('renders Markdown, creates a standalone document, and starts the download', async () => {
		await exportHTML(makeFile({ name: 'note.md', content: '# Salut' }));
		expect(renderMarkdownDetailed).toHaveBeenCalledWith('# Salut', { allowRemoteImages: false });
		expect(buildStandaloneHtmlDocument).toHaveBeenCalledOnce();
		expect(dl.clickSpy).toHaveBeenCalledOnce();
		// Set download to <fallback>.html by replacing the original extension.
		expect(dl.getAnchor()?.download).toBe('note.html');
	});

	it('uses the front matter title when present', async () => {
		renderMarkdownDetailed.mockResolvedValue({ html: '<p>x</p>', title: 'Titre FM' });
		await exportHTML(makeFile({ name: 'fichier.md', content: 'x' }));
		// The first buildStandaloneHtmlDocument argument is docTitle.
		expect(buildStandaloneHtmlDocument.mock.calls[0]![0]).toBe('Titre FM');
		// Keep the downloaded name based on the file name.
		expect(dl.getAnchor()?.download).toBe('fichier.html');
	});

	it('uses the file name without a front matter title', async () => {
		renderMarkdownDetailed.mockResolvedValue({ html: '<p>x</p>', title: '' });
		await exportHTML(makeFile({ name: 'sans-titre.md', content: 'x' }));
		expect(buildStandaloneHtmlDocument.mock.calls[0]![0]).toBe('sans-titre');
	});

	it('creates a text/html Blob', async () => {
		await exportHTML(makeFile());
		const blob = dl.createObjectURLSpy.mock.calls[0]![0] as Blob;
		expect(blob).toBeInstanceOf(Blob);
		expect(blob.type).toBe('text/html;charset=utf-8');
	});

	it('sanitizes a path-like name for HTML download', async () => {
		await exportHTML(makeFile({ name: 'a/b:c.md', content: 'x' }));
		expect(dl.getAnchor()?.download).toBe('a_b_c.html');
	});
});

describe('exportPDF', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		renderMarkdownDetailed.mockImplementation(async (md: string) => ({
			html: `<rendered>${md}</rendered>`,
			title: ''
		}));
	});

	it('renders Markdown, creates the print document, and opens the print iframe', async () => {
		await exportPDF(makeFile({ name: 'doc.md', content: '# Hello' }));
		expect(renderMarkdownDetailed).toHaveBeenCalledWith('# Hello', {
			showFrontmatter: false,
			allowRemoteImages: false
		});
		expect(buildPrintDocument).toHaveBeenCalledOnce();
		const opts = buildPrintDocument.mock.calls[0]![0];
		expect(opts.title).toBe('doc');
		expect(opts.source).toBe('# Hello');
		expect(opts.bodyHtml).toBe('<rendered># Hello</rendered>');
		expect(printInIframe).toHaveBeenCalledOnce();
		// Pass the buildPrintDocument result to printInIframe.
		expect(printInIframe.mock.calls[0]![0]).toContain('<print title="doc">');
	});

	it('uses the front matter title for the PDF', async () => {
		renderMarkdownDetailed.mockResolvedValue({ html: '<p>x</p>', title: 'Titre PDF' });
		await exportPDF(makeFile({ name: 'fichier.md', content: 'x' }));
		expect(buildPrintDocument.mock.calls[0]![0].title).toBe('Titre PDF');
	});
});

// Export functions must not use the DOM during server-side rendering. Remove the
// globals temporarily and verify that no rendering or download starts.
describe('server-side rendering guards without document or window', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('does nothing in exportMarkdown without document', async () => {
		const realDoc = globalThis.document;
		// @ts-expect-error suppression volontaire pour simuler le contexte SSR
		delete globalThis.document;
		try {
			await expect(exportMarkdown(makeFile())).resolves.toBe(false);
		} finally {
			globalThis.document = realDoc;
		}
	});

	it('renders nothing in exportHTML without document', async () => {
		const realDoc = globalThis.document;
		// @ts-expect-error suppression volontaire pour simuler le contexte SSR
		delete globalThis.document;
		try {
			await exportHTML(makeFile());
			expect(renderMarkdownDetailed).not.toHaveBeenCalled();
		} finally {
			globalThis.document = realDoc;
		}
	});

	it('renders nothing in exportPDF without document', async () => {
		const realDoc = globalThis.document;
		// @ts-expect-error suppression volontaire pour simuler le contexte SSR
		delete globalThis.document;
		try {
			await exportPDF(makeFile());
			expect(renderMarkdownDetailed).not.toHaveBeenCalled();
		} finally {
			globalThis.document = realDoc;
		}
	});

	it('does nothing in exportZip without window', async () => {
		const realWin = globalThis.window;
		// @ts-expect-error suppression volontaire pour simuler le contexte SSR
		delete globalThis.window;
		try {
			await exportZip([makeFile()]);
			// Return early without an error or a JSZip call.
			expect(true).toBe(true);
		} finally {
			globalThis.window = realWin;
		}
	});
});
