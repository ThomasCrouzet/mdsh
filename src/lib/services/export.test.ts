import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import type { FileItem } from '$lib/types';

// Mocks des modules lazy-importés par exportHTML / exportPDF. On isole le
// service d'export du vrai pipeline de rendu (marked / KaTeX / Mermaid /
// DOMPurify) et du vrai print iframe - ces couches sont couvertes ailleurs
// (markdown.test.ts, print.test.ts, e2e Playwright). Ici on vérifie
// l'orchestration : titre choisi, document construit, download déclenché.
const renderMarkdownDetailed = vi.fn(async (md: string) => ({
	html: `<rendered>${md}</rendered>`,
	title: ''
}));
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
	renderMarkdownDetailed: (md: string) => renderMarkdownDetailed(md)
}));
vi.mock('../render/print', () => ({
	buildStandaloneHtmlDocument: (title: string, bodyHtml: string, source?: string) =>
		buildStandaloneHtmlDocument(title, bodyHtml, source),
	buildPrintDocument: (opts: { title: string; bodyHtml: string; source?: string }) =>
		buildPrintDocument(opts),
	printInIframe: (html: string) => printInIframe(html)
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
		createdAnchor = null;
		clickSpy = vi.fn();
		// Intercepter document.createElement('a') pour récupérer l'anchor créé
		// par le service et inspecter ses attributs (href, download) avant click().
		// On évite vi.spyOn qui galère avec les surcharges génériques de createElement
		// (TypeScript se plaint sur la signature MockInstance<...>) - on remplace
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
		// jsdom n'implémente pas URL.createObjectURL - on stub.
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

	it('crée un anchor avec le nom du fichier en download', () => {
		const file = makeFile({ name: 'mon-doc.md' });
		exportMarkdown(file);
		expect(clickSpy).toHaveBeenCalledOnce();
		expect(createdAnchor?.download).toBe('mon-doc.md');
		expect(createdAnchor?.href).toBe('blob:mocked');
	});

	it('passe un Blob de type text/markdown à URL.createObjectURL', () => {
		const file = makeFile({ content: '# Titre' });
		exportMarkdown(file);
		expect(createObjectURLSpy).toHaveBeenCalledOnce();
		// mock.calls[0]![0] : le spy a été appelé une fois (assertion above), l'index 0 est garanti.
		const blob = createObjectURLSpy.mock.calls[0]![0] as Blob;
		expect(blob).toBeInstanceOf(Blob);
		expect(blob.type).toBe('text/markdown;charset=utf-8');
	});

	it("révoque l'URL après le click", () => {
		exportMarkdown(makeFile());
		expect(revokeObjectURLSpy).toHaveBeenCalledOnce();
	});

	it('ne mute pas le FileItem (pureté)', () => {
		const file = makeFile({ dirty: true });
		const before = { ...file };
		exportMarkdown(file);
		expect(file).toEqual(before);
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

	it("ne fait rien sur une liste vide (pas d'anchor créé)", async () => {
		await exportZip([]);
		expect(clickSpy).not.toHaveBeenCalled();
		expect(createObjectURLSpy).not.toHaveBeenCalled();
	});

	// jsdom + JSZip{type:'blob'} : sur certaines combinaisons jsdom/Blob le
	// résultat est valide (Buffer-backed Blob), sur d'autres pas. On garde
	// `'blob'` en prod (testé via E2E Playwright) et on accepte ici toute
	// valeur passée à URL.createObjectURL - ce qui compte pour l'unitaire,
	// c'est que l'orchestration (un seul click, pas N) est correcte.
	it('crée un seul download pour N fichiers (vs N téléchargements)', async () => {
		const files = [
			makeFile({ id: '1', name: 'a.md', content: '# A' }),
			makeFile({ id: '2', name: 'b.md', content: '# B' }),
			makeFile({ id: '3', name: 'c.md', content: '# C' })
		];
		await exportZip(files, 'export.zip');
		expect(clickSpy).toHaveBeenCalledTimes(1);
		expect(createdAnchor?.download).toBe('export.zip');
		expect(createObjectURLSpy).toHaveBeenCalledOnce();
		// mock.calls[0]![0] : le spy a été appelé une fois (assertion above), l'index 0 est garanti.
		const blob = createObjectURLSpy.mock.calls[0]![0];
		expect(blob).toBeInstanceOf(Blob);
	});

	it('utilise le filename par défaut si non fourni', async () => {
		const files = [makeFile({ id: '1', name: 'a.md' })];
		await exportZip(files);
		expect(createdAnchor?.download).toBe('mdsh-export.zip');
	});

	// Garantit qu'on n'écrase pas silencieusement l'un des deux fichiers
	// quand l'utilisateur a deux "Sans titre.md" actifs. JSZip écraserait
	// l'entrée précédente sinon - perte de données en silence.
	//
	// La signature de JSZip.file() est surchargée (lecture/écriture) - on by-pass
	// le typage strict via `unknown` pour le mock, ce qui est acceptable dans un
	// test (cf. note dans le doc TypeScript sur le pattern de double cast).
	it('résout les collisions de noms (deux fichiers identiques)', async () => {
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
			// 3 entrées distinctes dans le zip, pas 1
			expect(filesAdded).toEqual(['Sans titre.md', 'Sans titre-2.md', 'Sans titre-3.md']);
		} finally {
			proto.file = realFile;
		}
	});

	it('préserve les noms uniques sans suffixage inutile', async () => {
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

	it('dédoublonne des noms sans extension (branche ext absente)', async () => {
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
			// Pas d'extension → suffixe collé en fin (README, README-2).
			expect(filesAdded).toEqual(['README', 'README-2']);
		} finally {
			proto.file = realFile;
		}
	});

	it('sanitize les noms interdits avant ajout au zip', async () => {
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
			// Aucun '/' ne doit subsister (sinon sous-arbre dans le zip).
			expect(filesAdded[0]).not.toContain('/');
			expect(filesAdded[0]).toBe('a_b_c_.md');
		} finally {
			proto.file = realFile;
		}
	});
});

// Helper partagé : intercepte la création d'anchor + stub URL.createObjectURL,
// pour les exports qui finissent par triggerDownload (HTML).
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
	it('remplace les caractères interdits par _', () => {
		expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j.md')).toBe('a_b_c_d_e_f_g_h_i_j.md');
	});

	it('neutralise les caractères de contrôle', () => {
		expect(sanitizeFilename('a\x00b\x1fc.md')).toBe('a_b_c.md');
	});

	it('laisse un nom déjà valide intact', () => {
		expect(sanitizeFilename('mon-doc.md')).toBe('mon-doc.md');
	});

	it('préserve une extension .md sur un nom valide', () => {
		// '.md' n'est PAS vide après trim, donc retourné tel quel (pas de fallback).
		expect(sanitizeFilename('.md')).toBe('.md');
	});

	it('retombe sur sans-titre pour un nom vide ou blanc sans extension', () => {
		expect(sanitizeFilename('')).toBe('sans-titre');
		expect(sanitizeFilename('   ')).toBe('sans-titre');
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

	it('rend le markdown, construit le doc standalone et déclenche le download', async () => {
		await exportHTML(makeFile({ name: 'note.md', content: '# Salut' }));
		expect(renderMarkdownDetailed).toHaveBeenCalledWith('# Salut');
		expect(buildStandaloneHtmlDocument).toHaveBeenCalledOnce();
		expect(dl.clickSpy).toHaveBeenCalledOnce();
		// download = <fallback>.html (nom sans extension + .html)
		expect(dl.getAnchor()?.download).toBe('note.html');
	});

	it('utilise le titre front-matter quand présent', async () => {
		renderMarkdownDetailed.mockResolvedValue({ html: '<p>x</p>', title: 'Titre FM' });
		await exportHTML(makeFile({ name: 'fichier.md', content: 'x' }));
		// Le 1er argument de buildStandaloneHtmlDocument = docTitle.
		expect(buildStandaloneHtmlDocument.mock.calls[0]![0]).toBe('Titre FM');
		// Le nom du fichier téléchargé reste basé sur le nom du fichier.
		expect(dl.getAnchor()?.download).toBe('fichier.html');
	});

	it('retombe sur le nom du fichier quand pas de titre front-matter', async () => {
		renderMarkdownDetailed.mockResolvedValue({ html: '<p>x</p>', title: '' });
		await exportHTML(makeFile({ name: 'sans-titre.md', content: 'x' }));
		expect(buildStandaloneHtmlDocument.mock.calls[0]![0]).toBe('sans-titre');
	});

	it('produit un Blob text/html', async () => {
		await exportHTML(makeFile());
		const blob = dl.createObjectURLSpy.mock.calls[0]![0] as Blob;
		expect(blob).toBeInstanceOf(Blob);
		expect(blob.type).toBe('text/html;charset=utf-8');
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

	it('rend le markdown, construit le print doc et ouvre le print iframe', async () => {
		await exportPDF(makeFile({ name: 'doc.md', content: '# Hello' }));
		expect(renderMarkdownDetailed).toHaveBeenCalledWith('# Hello');
		expect(buildPrintDocument).toHaveBeenCalledOnce();
		const opts = buildPrintDocument.mock.calls[0]![0];
		expect(opts.title).toBe('doc');
		expect(opts.source).toBe('# Hello');
		expect(printInIframe).toHaveBeenCalledOnce();
		// Le HTML passé à printInIframe = le retour de buildPrintDocument.
		expect(printInIframe.mock.calls[0]![0]).toContain('<print title="doc">');
	});

	it('utilise le titre front-matter pour le PDF', async () => {
		renderMarkdownDetailed.mockResolvedValue({ html: '<p>x</p>', title: 'Titre PDF' });
		await exportPDF(makeFile({ name: 'fichier.md', content: 'x' }));
		expect(buildPrintDocument.mock.calls[0]![0].title).toBe('Titre PDF');
	});
});

// Garde SSR : aucune fonction d'export ne doit toucher le DOM si `document` /
// `window` sont absents (build statique côté serveur). On retire temporairement
// les globaux et on vérifie le no-op (aucun rendu, aucun download).
describe('garde SSR (document/window indisponibles)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('exportMarkdown ne fait rien sans document', () => {
		const realDoc = globalThis.document;
		// @ts-expect-error suppression volontaire pour simuler le contexte SSR
		delete globalThis.document;
		try {
			expect(() => exportMarkdown(makeFile())).not.toThrow();
		} finally {
			globalThis.document = realDoc;
		}
	});

	it('exportHTML ne rend rien sans document', async () => {
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

	it('exportPDF ne rend rien sans document', async () => {
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

	it('exportZip ne fait rien sans window', async () => {
		const realWin = globalThis.window;
		// @ts-expect-error suppression volontaire pour simuler le contexte SSR
		delete globalThis.window;
		try {
			await exportZip([makeFile()]);
			// Aucune erreur, et JSZip jamais sollicité (sortie précoce).
			expect(true).toBe(true);
		} finally {
			globalThis.window = realWin;
		}
	});
});
