import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db, type DraftRow } from './db';

// Les wrappers d'export et de disque délèguent à des modules purs : on les mocke
// pour vérifier la délégation (args + cible) sans déclencher de vrai export ni la
// File System Access API. Les mocks sont hoistés et s'appliquent à tout le fichier ;
// les autres suites n'en dépendent pas (elles testent l'orchestration en mémoire).
vi.mock('./export-ops', () => ({
	exportMarkdown: vi.fn(),
	exportAllZip: vi.fn(async () => {}),
	exportHTML: vi.fn(async () => {}),
	exportPDF: vi.fn(async () => {}),
	exportSelectionZip: vi.fn(async () => {})
}));
vi.mock('./disk-sync', () => ({
	openFromDisk: vi.fn(async () => []),
	saveToDisk: vi.fn(async () => true),
	unlinkFromDisk: vi.fn(async () => {}),
	refreshBrokenLinks: vi.fn(async () => {})
}));

import * as exportOps from './export-ops';
import * as diskSync from './disk-sync';
import { filesStore } from './files.svelte';

// Tests de l'orchestrateur FilesStore (singleton runes) sous fake-indexeddb.
// La logique pure injectée (file-utils, trash, meta-index...) a ses propres
// suites ; ici on cible les chemins d'orchestration : création, édition, dirty,
// corbeille + restauration, fermeture, réordonnancement, sélection multiple,
// chargement/rechargement, import, backlinks.

function draftRow(id: string, name: string, content = '', order = 0): DraftRow {
	return { id, name, content, createdAt: 1000, updatedAt: 1000, order };
}

function mdFile(name: string, content = '# x'): File {
	const f = new File([content], name, { type: 'text/markdown' });
	// jsdom's File may lack `.text()`; shim it so importFiles can read content.
	if (typeof f.text !== 'function') {
		Object.defineProperty(f, 'text', { value: async () => content });
	}
	return f;
}

beforeEach(async () => {
	await Promise.all([
		db.drafts.clear(),
		db.trashed.clear(),
		db.versions.clear(),
		db.workspaces.clear()
	]);
	localStorage.clear();
	// reload(false) annule les saves/timers en cours, vide l'état runes et relit
	// depuis la base (désormais vide) : reset propre du singleton entre tests.
	await filesStore.reload(false);
});

afterEach(() => {
	filesStore.selectionClear();
});

describe('createNew', () => {
	it("crée un fichier, l'ajoute et l'active", () => {
		const f = filesStore.createNew('a.md', '# A');
		expect(filesStore.files.map((x) => x.id)).toContain(f.id);
		expect(filesStore.activeId).toBe(f.id);
		expect(filesStore.active?.name).toBe('a.md');
		expect(f.dirty).toBe(true);
	});

	it('déduplique les noms (uniqueName)', () => {
		filesStore.createNew('note.md', '');
		const b = filesStore.createNew('note.md', '');
		expect(b.name).not.toBe('note.md');
		expect(b.name).toMatch(/note-2\.md|note \(2\)\.md|note-1\.md/);
	});

	it("utilise un nom par défaut quand aucun n'est fourni", () => {
		const f = filesStore.createNew();
		expect(f.name.endsWith('.md')).toBe(true);
		expect(f.name.length).toBeGreaterThan(3);
	});
});

describe('updateContent', () => {
	it('met à jour le contenu et marque dirty', () => {
		const f = filesStore.createNew('a.md', 'old');
		filesStore.updateContent(f.id, 'new');
		expect(filesStore.files.find((x) => x.id === f.id)?.content).toBe('new');
		expect(filesStore.files.find((x) => x.id === f.id)?.dirty).toBe(true);
	});

	it('no-op si le contenu est identique', () => {
		const f = filesStore.createNew('a.md', 'same');
		const before = filesStore.files.find((x) => x.id === f.id)?.updatedAt;
		filesStore.updateContent(f.id, 'same');
		expect(filesStore.files.find((x) => x.id === f.id)?.updatedAt).toBe(before);
	});
});

describe('close + restore (corbeille)', () => {
	it('close (trash) retire de la vue puis restore réinjecte', async () => {
		const f = filesStore.createNew('a.md', '# A');
		await filesStore.flushPending();
		filesStore.close(f.id);
		expect(filesStore.files.some((x) => x.id === f.id)).toBe(false);
		expect(filesStore.trash.some((t) => t.file.id === f.id)).toBe(true);

		const restored = filesStore.restore(f.id);
		expect(restored?.id).toBe(f.id);
		expect(filesStore.files.some((x) => x.id === f.id)).toBe(true);
		expect(filesStore.trash.some((t) => t.file.id === f.id)).toBe(false);
		// La restauration est atomique : le draft est en base.
		expect(await db.drafts.get(f.id)).toBeTruthy();
	});

	it('close keepDB retire la vue sans supprimer le draft', async () => {
		const f = filesStore.createNew('a.md', '# A');
		await filesStore.flushPending();
		filesStore.close(f.id, { trash: false, keepDB: true });
		expect(filesStore.files.some((x) => x.id === f.id)).toBe(false);
		expect(await db.drafts.get(f.id)).toBeTruthy(); // draft conservé
		expect(filesStore.trash.some((t) => t.file.id === f.id)).toBe(false);
	});

	it('close hard-delete supprime le draft de la base', async () => {
		const f = filesStore.createNew('a.md', '# A');
		await filesStore.flushPending();
		filesStore.close(f.id, { trash: false });
		expect(filesStore.files.some((x) => x.id === f.id)).toBe(false);
		expect(await db.drafts.get(f.id)).toBeUndefined();
	});

	it("restore d'un id inconnu retourne null", () => {
		expect(filesStore.restore('ghost')).toBeNull();
	});
});

describe('rename', () => {
	it('renomme (normalisé, extension préservée)', () => {
		const f = filesStore.createNew('a.md', '');
		filesStore.rename(f.id, 'renamed');
		expect(filesStore.files.find((x) => x.id === f.id)?.name).toBe('renamed.md');
	});
});

describe('reorder', () => {
	it('réordonne les fichiers en mémoire', () => {
		const a = filesStore.createNew('a.md', '');
		const b = filesStore.createNew('b.md', '');
		const c = filesStore.createNew('c.md', '');
		// déplace a après c
		filesStore.reorder(a.id, c.id);
		const order = filesStore.files.map((x) => x.id);
		expect(order.indexOf(a.id)).toBeGreaterThan(order.indexOf(b.id));
	});
});

describe('sélection multiple', () => {
	it('toggle, range et clear', () => {
		const a = filesStore.createNew('a.md', '');
		const b = filesStore.createNew('b.md', '');
		const c = filesStore.createNew('c.md', '');
		filesStore.selectionToggle(a.id);
		expect(filesStore.selectedIds.has(a.id)).toBe(true);
		filesStore.selectionToggle(a.id);
		expect(filesStore.selectedIds.has(a.id)).toBe(false);

		filesStore.selectionRange(a.id, c.id);
		expect(filesStore.selectedIds.has(a.id)).toBe(true);
		expect(filesStore.selectedIds.has(b.id)).toBe(true);
		expect(filesStore.selectedIds.has(c.id)).toBe(true);

		filesStore.selectionClear();
		expect(filesStore.selectedIds.size).toBe(0);
	});

	it('closeSelected ferme tous les fichiers sélectionnés', async () => {
		const a = filesStore.createNew('a.md', '');
		const b = filesStore.createNew('b.md', '');
		await filesStore.flushPending();
		filesStore.selectionToggle(a.id);
		filesStore.selectionToggle(b.id);
		filesStore.closeSelected();
		expect(filesStore.files.some((x) => x.id === a.id || x.id === b.id)).toBe(false);
	});
});

describe('load', () => {
	it('charge les drafts ordonnés et restaure activeId', async () => {
		await db.drafts.bulkPut([draftRow('b', 'b.md', '', 1), draftRow('a', 'a.md', '', 0)]);
		localStorage.setItem('mdsh:activeId', 'b');
		filesStore.loaded = false;
		filesStore.files = [];
		await filesStore.load();
		expect(filesStore.files.map((f) => f.id)).toEqual(['a', 'b']);
		expect(filesStore.activeId).toBe('b');
	});

	it("active le premier fichier si l'activeId persisté n'existe plus", async () => {
		await db.drafts.put(draftRow('a', 'a.md', '', 0));
		localStorage.setItem('mdsh:activeId', 'disparu');
		filesStore.loaded = false;
		filesStore.files = [];
		await filesStore.load();
		expect(filesStore.activeId).toBe('a');
	});
});

describe('importFiles', () => {
	it('importe les markdown, ignore les non-markdown', async () => {
		const res = await filesStore.importFiles([
			mdFile('one.md', '# One'),
			mdFile('two.md', '# Two'),
			new File(['x'], 'image.png', { type: 'image/png' })
		]);
		expect(res.created.length).toBe(2);
		expect(res.skipped).toBe(1);
		expect(res.failed).toBe(0);
		expect(filesStore.files.length).toBe(2);
	});
});

describe('backlinks / wiki-links', () => {
	it('résout les wiki-links et calcule les backlinks', () => {
		const target = filesStore.createNew('Cible.md', '# Cible');
		const source = filesStore.createNew('Source.md', 'voir [[Cible]] ici');
		const links = filesStore.wikiLinkTargets(source.id);
		expect(links.map((l) => l.toLowerCase())).toContain('cible');
		const back = filesStore.backlinks(target.id);
		expect(back.some((f) => f.id === source.id)).toBe(true);
		expect(filesStore.resolveWikiLink('Cible')).toBe(target.id);
		expect(filesStore.resolveWikiLink('Inexistant')).toBeNull();
	});
});

describe('loadDemo', () => {
	it('crée les fichiers de démo, wiki-liés, et active le premier', () => {
		const created = filesStore.loadDemo();
		expect(created.length).toBe(3);
		expect(filesStore.files.length).toBe(3);
		expect(filesStore.activeId).toBe(created[0]!.id);

		// Les fichiers "Math and diagrams" et "Task list" pointent vers le premier
		// via [[Welcome to the mdsh demo]] - vérifie que ça se résout en backlinks.
		const welcome = created[0]!;
		const back = filesStore.backlinks(welcome.id);
		expect(back.length).toBe(2);
	});

	it('appelée deux fois ne crée pas de doublons de nom (uniqueName)', () => {
		filesStore.loadDemo();
		filesStore.loadDemo();
		expect(filesStore.files.length).toBe(6);
		expect(new Set(filesStore.files.map((f) => f.name)).size).toBe(6);
	});
});

describe('replaceInAll', () => {
	it('remplace une occurrence dans tous les fichiers', () => {
		const a = filesStore.createNew('a.md', 'foo bar foo');
		filesStore.createNew('b.md', 'no match');
		const res = filesStore.replaceInAll('foo', 'baz', {
			caseSensitive: true,
			wholeWord: false,
			useRegex: false
		});
		expect(res.regexError).toBeNull();
		expect(res.occurrences).toBeGreaterThanOrEqual(1);
		expect(res.files).toBeGreaterThanOrEqual(1);
		expect(filesStore.files.find((x) => x.id === a.id)?.content).toContain('baz');
	});

	it('retourne regexError sur une regex invalide (useRegex)', () => {
		filesStore.createNew('a.md', 'foo bar');
		const res = filesStore.replaceInAll('(unclosed', 'x', {
			caseSensitive: false,
			wholeWord: false,
			useRegex: true
		});
		expect(res.regexError).not.toBeNull();
		expect(res.files).toBe(0);
		expect(res.occurrences).toBe(0);
		// La regex invalide ne touche aucun contenu.
		expect(filesStore.files.find((x) => x.name === 'a.md')?.content).toBe('foo bar');
	});
});

describe('exports (délégation → export-ops)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('export(id) délègue à exportMarkdown avec exportDeps', () => {
		const a = filesStore.createNew('a.md', '# A');
		filesStore.export(a.id);
		expect(exportOps.exportMarkdown).toHaveBeenCalledTimes(1);
		const [id, deps] = vi.mocked(exportOps.exportMarkdown).mock.calls[0]!;
		expect(id).toBe(a.id);
		// exportDeps expose getFiles + scheduleSave.
		expect(typeof deps.getFiles).toBe('function');
		expect(typeof deps.scheduleSave).toBe('function');
		expect(deps.getFiles().some((f) => f.id === a.id)).toBe(true);
	});

	it('exportActive() exporte le fichier actif', () => {
		filesStore.createNew('a.md', '# A');
		const b = filesStore.createNew('b.md', '# B');
		filesStore.setActive(b.id);
		filesStore.exportActive();
		expect(exportOps.exportMarkdown).toHaveBeenCalledTimes(1);
		expect(vi.mocked(exportOps.exportMarkdown).mock.calls[0]![0]).toBe(b.id);
	});

	it('exportActive() ne fait rien sans fichier actif', () => {
		// Aucun fichier ouvert → active === null.
		expect(filesStore.active).toBeNull();
		filesStore.exportActive();
		expect(exportOps.exportMarkdown).not.toHaveBeenCalled();
	});

	it('exportAll() délègue à exportAllZip', async () => {
		filesStore.createNew('a.md', '# A');
		await filesStore.exportAll();
		expect(exportOps.exportAllZip).toHaveBeenCalledTimes(1);
		const deps = vi.mocked(exportOps.exportAllZip).mock.calls[0]![0];
		expect(typeof deps.getFiles).toBe('function');
	});

	it('exportHTML(id) délègue à exportHTML avec le bon id', async () => {
		const a = filesStore.createNew('a.md', '# A');
		await filesStore.exportHTML(a.id);
		expect(exportOps.exportHTML).toHaveBeenCalledTimes(1);
		expect(vi.mocked(exportOps.exportHTML).mock.calls[0]![0]).toBe(a.id);
	});

	it('exportActiveHTML() exporte le fichier actif en HTML', async () => {
		const a = filesStore.createNew('a.md', '# A');
		await filesStore.exportActiveHTML();
		expect(exportOps.exportHTML).toHaveBeenCalledTimes(1);
		expect(vi.mocked(exportOps.exportHTML).mock.calls[0]![0]).toBe(a.id);
	});

	it('exportActiveHTML() ne fait rien sans fichier actif', async () => {
		await filesStore.exportActiveHTML();
		expect(exportOps.exportHTML).not.toHaveBeenCalled();
	});

	it('exportPDF(id) délègue à exportPDF avec le bon id', async () => {
		const a = filesStore.createNew('a.md', '# A');
		await filesStore.exportPDF(a.id);
		expect(exportOps.exportPDF).toHaveBeenCalledTimes(1);
		expect(vi.mocked(exportOps.exportPDF).mock.calls[0]![0]).toBe(a.id);
	});

	it('exportActivePDF() exporte le fichier actif en PDF', async () => {
		const a = filesStore.createNew('a.md', '# A');
		await filesStore.exportActivePDF();
		expect(exportOps.exportPDF).toHaveBeenCalledTimes(1);
		expect(vi.mocked(exportOps.exportPDF).mock.calls[0]![0]).toBe(a.id);
	});

	it('exportActivePDF() ne fait rien sans fichier actif', async () => {
		await filesStore.exportActivePDF();
		expect(exportOps.exportPDF).not.toHaveBeenCalled();
	});

	it('exportSelectedZip() délègue à exportSelectionZip avec la sélection', async () => {
		const a = filesStore.createNew('a.md', '# A');
		const b = filesStore.createNew('b.md', '# B');
		filesStore.selectionToggle(a.id);
		filesStore.selectionToggle(b.id);
		await filesStore.exportSelectedZip();
		expect(exportOps.exportSelectionZip).toHaveBeenCalledTimes(1);
		const [selected, deps] = vi.mocked(exportOps.exportSelectionZip).mock.calls[0]!;
		expect(selected.has(a.id)).toBe(true);
		expect(selected.has(b.id)).toBe(true);
		expect(typeof deps.getFiles).toBe('function');
	});
});

describe('disque (délégation → disk-sync)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('openFromDisk() délègue à disk-sync.openFromDisk avec diskDeps', async () => {
		await filesStore.openFromDisk();
		expect(diskSync.openFromDisk).toHaveBeenCalledTimes(1);
		const deps = vi.mocked(diskSync.openFromDisk).mock.calls[0]![0];
		expect(typeof deps.getFile).toBe('function');
		expect(typeof deps.onCreate).toBe('function');
		expect(typeof deps.scheduleSave).toBe('function');
	});

	it('saveToDisk(id) délègue avec le bon id et diskDeps', async () => {
		const a = filesStore.createNew('a.md', '# A');
		const ok = await filesStore.saveToDisk(a.id);
		expect(ok).toBe(true);
		expect(diskSync.saveToDisk).toHaveBeenCalledTimes(1);
		const [id, deps] = vi.mocked(diskSync.saveToDisk).mock.calls[0]!;
		expect(id).toBe(a.id);
		// diskDeps.getFile retrouve bien le fichier dans le store.
		expect(deps.getFile(a.id)?.id).toBe(a.id);
	});

	it('saveActiveToDisk() enregistre le fichier actif', async () => {
		filesStore.createNew('a.md', '# A');
		const b = filesStore.createNew('b.md', '# B');
		filesStore.setActive(b.id);
		const ok = await filesStore.saveActiveToDisk();
		expect(ok).toBe(true);
		expect(diskSync.saveToDisk).toHaveBeenCalledTimes(1);
		expect(vi.mocked(diskSync.saveToDisk).mock.calls[0]![0]).toBe(b.id);
	});

	it('saveActiveToDisk() retourne false sans fichier actif', async () => {
		expect(filesStore.active).toBeNull();
		const ok = await filesStore.saveActiveToDisk();
		expect(ok).toBe(false);
		expect(diskSync.saveToDisk).not.toHaveBeenCalled();
	});

	it('unlinkFromDisk(id) délègue à disk-sync.unlinkFromDisk', async () => {
		const a = filesStore.createNew('a.md', '# A');
		await filesStore.unlinkFromDisk(a.id);
		expect(diskSync.unlinkFromDisk).toHaveBeenCalledTimes(1);
		expect(vi.mocked(diskSync.unlinkFromDisk).mock.calls[0]![0]).toBe(a.id);
	});

	it('refreshBrokenLinks() délègue avec la liste de fichiers et un accesseur', async () => {
		const a = filesStore.createNew('a.md', '# A');
		await filesStore.refreshBrokenLinks();
		expect(diskSync.refreshBrokenLinks).toHaveBeenCalledTimes(1);
		const [files, getter] = vi.mocked(diskSync.refreshBrokenLinks).mock.calls[0]!;
		expect(files.some((f) => f.id === a.id)).toBe(true);
		expect(getter(a.id)?.id).toBe(a.id);
	});
});

describe('flushPending', () => {
	it('persiste immédiatement les éditions en attente', async () => {
		const f = filesStore.createNew('a.md', '# A');
		filesStore.updateContent(f.id, '# A modifié');
		// L'écriture est debouncée (400 ms) : pas encore en base.
		filesStore.flushPending();
		// flushPending écrit de façon synchrone via la SaveQueue ; on laisse la
		// microtask Dexie se résoudre.
		await Promise.resolve();
		await new Promise((r) => setTimeout(r, 0));
		const row = await db.drafts.get(f.id);
		expect(row?.content).toBe('# A modifié');
	});
});

describe('closeMany / openMany', () => {
	it('closeMany ferme plusieurs fichiers, ignore les ids inconnus', async () => {
		const a = filesStore.createNew('a.md', '# A');
		const b = filesStore.createNew('b.md', '# B');
		await filesStore.flushPending();
		filesStore.closeMany([a.id, b.id, 'ghost'], { trash: false, keepDB: true });
		expect(filesStore.files.some((x) => x.id === a.id || x.id === b.id)).toBe(false);
		// keepDB : les drafts restent en base.
		expect(await db.drafts.get(a.id)).toBeTruthy();
		expect(await db.drafts.get(b.id)).toBeTruthy();
	});

	it('closeMany no-op quand aucun id ne correspond', () => {
		const a = filesStore.createNew('a.md', '# A');
		filesStore.closeMany(['ghost1', 'ghost2']);
		expect(filesStore.files.some((x) => x.id === a.id)).toBe(true);
	});

	it('openMany réinjecte des rows Dexie sans les recréer', () => {
		const rows: DraftRow[] = [draftRow('x', 'x.md', '# X', 0), draftRow('y', 'y.md', '# Y', 1)];
		filesStore.openMany(rows);
		expect(filesStore.files.map((f) => f.id)).toEqual(expect.arrayContaining(['x', 'y']));
		const x = filesStore.files.find((f) => f.id === 'x');
		expect(x?.content).toBe('# X');
		expect(x?.dirty).toBe(false);
	});

	it('openMany ignore les rows déjà ouverts (dédup par id)', () => {
		filesStore.openMany([draftRow('x', 'x.md', '# X', 0)]);
		const before = filesStore.files.length;
		filesStore.openMany([draftRow('x', 'x.md', '# X bis', 0)]);
		expect(filesStore.files.length).toBe(before);
		// Le contenu existant n'est pas écrasé.
		expect(filesStore.files.find((f) => f.id === 'x')?.content).toBe('# X');
	});

	it('openMany no-op sur une liste vide', () => {
		filesStore.openMany([]);
		expect(filesStore.files.length).toBe(0);
	});
});

describe('métadonnées (getTags / displayTitle / wiki-links)', () => {
	it('getTags lit les tags du front-matter, [] si id inconnu', () => {
		const f = filesStore.createNew('a.md', '---\ntags: [un, deux]\n---\ncorps');
		expect(filesStore.getTags(f.id)).toEqual(expect.arrayContaining(['un', 'deux']));
		expect(filesStore.getTags('ghost')).toEqual([]);
	});

	it('displayTitle : front-matter title > H1 > nom de fichier', () => {
		const fm = filesStore.createNew('a.md', '---\ntitle: Titre YAML\n---\n# Autre');
		expect(filesStore.displayTitle(fm.id)).toBe('Titre YAML');
		const noFm = filesStore.createNew('mon-doc.md', 'pas de front-matter');
		// Sans front-matter, fallback sur le nom sans extension.
		expect(filesStore.displayTitle(noFm.id)).toBe('mon-doc');
		// Id inconnu : chaîne vide.
		expect(filesStore.displayTitle('ghost')).toBe('');
	});

	it('resolveWikiLink : par id, par nom, null sur vide ou inconnu', () => {
		const target = filesStore.createNew('Cible.md', '# Cible');
		expect(filesStore.resolveWikiLink(target.id)).toBe(target.id);
		expect(filesStore.resolveWikiLink('cible')).toBe(target.id);
		expect(filesStore.resolveWikiLink('   ')).toBeNull();
		expect(filesStore.resolveWikiLink('Inexistant')).toBeNull();
	});

	it('openWikiLink active une cible existante', () => {
		const target = filesStore.createNew('Cible.md', '# Cible');
		filesStore.createNew('Autre.md', '# Autre');
		const id = filesStore.openWikiLink('Cible');
		expect(id).toBe(target.id);
		expect(filesStore.activeId).toBe(target.id);
	});

	it('openWikiLink crée un nouveau fichier si la cible est absente', () => {
		const before = filesStore.files.length;
		const id = filesStore.openWikiLink('Nouvelle Note');
		expect(id).not.toBeNull();
		expect(filesStore.files.length).toBe(before + 1);
		const created = filesStore.files.find((f) => f.id === id);
		expect(created?.name).toBe('Nouvelle Note.md');
		expect(filesStore.activeId).toBe(id);
	});

	it('openWikiLink retourne null sur une cible vide non résolue', () => {
		const before = filesStore.files.length;
		// Cible vide → resolveWikiLink null puis trimmed vide → null, sans création.
		expect(filesStore.openWikiLink('   ')).toBeNull();
		expect(filesStore.files.length).toBe(before);
	});

	it('allTags agrège et trie les tags du corpus', () => {
		filesStore.createNew('a.md', '---\ntags: [zebre, alpha]\n---\n');
		filesStore.createNew('b.md', '---\ntags: [alpha, mango]\n---\n');
		expect(filesStore.allTags).toEqual(['alpha', 'mango', 'zebre']);
	});
});
