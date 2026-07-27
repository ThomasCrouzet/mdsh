import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

import { db, newId, type DraftRow, type WorkspaceRow, type TemplateRow } from '../db';
import {
	BACKUP_FORMAT,
	BACKUP_SCHEMA_VERSION,
	BackupParseError,
	applyBackup,
	collectBackup,
	decryptBackupText,
	downloadBackup,
	isEncryptedBackup,
	parseBackup,
	restoreFromFile,
	restoreFromText,
	serializeBackup,
	type BackupFile
} from './backup';
import { encryptString } from '../crypto';

// jsdom Blob/File peuvent ne pas exposer `.text()`. On lit le contenu via
// FileReader (supporté par jsdom) avec repli sur `.text()` quand il existe.
function blobText(blob: Blob): Promise<string> {
	if (typeof blob.text === 'function') return blob.text();
	return new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error);
		reader.readAsText(blob);
	});
}

async function clearAll() {
	await Promise.all([
		db.drafts.clear(),
		db.workspaces.clear(),
		db.templates.clear(),
		db.versions.clear()
	]);
}

beforeEach(clearAll);
afterEach(clearAll);

function draft(p: Partial<DraftRow> = {}): DraftRow {
	const now = Date.now();
	return {
		id: p.id ?? newId(),
		name: p.name ?? 'doc.md',
		content: p.content ?? 'hello',
		createdAt: p.createdAt ?? now,
		updatedAt: p.updatedAt ?? now,
		order: p.order ?? 0
	};
}
function workspace(p: Partial<WorkspaceRow> = {}): WorkspaceRow {
	const now = Date.now();
	return {
		id: p.id ?? newId(),
		name: p.name ?? 'WS',
		fileIds: p.fileIds ?? [],
		activeId: p.activeId ?? null,
		createdAt: p.createdAt ?? now,
		updatedAt: p.updatedAt ?? now
	};
}
function template(p: Partial<TemplateRow> = {}): TemplateRow {
	const now = Date.now();
	return {
		id: p.id ?? newId(),
		name: p.name ?? 'T',
		content: p.content ?? '# x',
		builtin: p.builtin ?? false,
		createdAt: p.createdAt ?? now,
		updatedAt: p.updatedAt ?? now
	};
}

describe('collectBackup', () => {
	it('capture drafts (ordonnés), workspaces et templates', async () => {
		await db.drafts.bulkPut([draft({ name: 'b', order: 1 }), draft({ name: 'a', order: 0 })]);
		await db.workspaces.put(workspace({ name: 'WS1' }));
		await db.templates.put(template({ name: 'Tpl' }));

		const b = await collectBackup(1234);
		expect(b.format).toBe(BACKUP_FORMAT);
		expect(b.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
		expect(b.exportedAt).toBe(1234);
		expect(b.drafts.map((d) => d.name)).toEqual(['a', 'b']); // ordre par `order`
		expect(b.workspaces).toHaveLength(1);
		expect(b.templates).toHaveLength(1);
	});

	it('exclut la corbeille et les versions (hors périmètre)', async () => {
		const b = await collectBackup();
		expect(b).not.toHaveProperty('trashed');
		expect(b).not.toHaveProperty('versions');
	});
});

describe('serializeBackup / parseBackup - roundtrip', () => {
	it('un backup sérialisé se re-parse à l’identique', async () => {
		await db.drafts.put(draft({ name: 'r.md', content: 'rt' }));
		const original = await collectBackup(999);
		const json = serializeBackup(original);
		const parsed = parseBackup(json);
		expect(parsed).toEqual(original);
	});
});

describe('parseBackup - validation', () => {
	it('rejette un JSON invalide', () => {
		expect(() => parseBackup('{not json')).toThrow(BackupParseError);
	});

	it('rejette un objet sans le bon format', () => {
		expect(() => parseBackup(JSON.stringify({ format: 'autre', schemaVersion: 1 }))).toThrow(
			/pas une sauvegarde mdsh/
		);
	});

	it('rejette une version de schéma future', () => {
		const json = JSON.stringify({
			format: BACKUP_FORMAT,
			schemaVersion: BACKUP_SCHEMA_VERSION + 1
		});
		expect(() => parseBackup(json)).toThrow(/version plus récente/);
	});

	it('rejette une version de schéma manquante', () => {
		expect(() => parseBackup(JSON.stringify({ format: BACKUP_FORMAT }))).toThrow(
			/version de schéma/
		);
	});

	it('rejette une version de schéma non-entière ou ≤ 0', () => {
		for (const bad of [0, -1, 0.5, 1.5]) {
			expect(() =>
				parseBackup(JSON.stringify({ format: BACKUP_FORMAT, schemaVersion: bad }))
			).toThrow(/incohérente/);
		}
	});

	it('tolère les tableaux manquants (défaut [])', () => {
		const json = JSON.stringify({ format: BACKUP_FORMAT, schemaVersion: 1 });
		const parsed = parseBackup(json);
		expect(parsed.drafts).toEqual([]);
		expect(parsed.workspaces).toEqual([]);
		expect(parsed.templates).toEqual([]);
	});

	it('filtre les rows drafts corrompus, garde les valides', () => {
		const good = draft({ id: 'g', name: 'ok.md' });
		const json = JSON.stringify({
			format: BACKUP_FORMAT,
			schemaVersion: 1,
			drafts: [good, { id: 'bad' /* manque les autres champs */ }, null, 42]
		});
		const parsed = parseBackup(json);
		expect(parsed.drafts).toHaveLength(1);
		expect(parsed.drafts[0]?.id).toBe('g');
	});
});

describe('applyBackup - replace', () => {
	it('remplace intégralement l’état existant', async () => {
		await db.drafts.put(draft({ id: 'old', name: 'old.md' }));
		const backup: BackupFile = {
			format: BACKUP_FORMAT,
			schemaVersion: 1,
			exportedAt: 0,
			drafts: [draft({ id: 'new', name: 'new.md' })],
			workspaces: [],
			templates: []
		};
		const counts = await applyBackup(backup, 'replace');
		expect(counts.drafts).toBe(1);
		const all = await db.drafts.toArray();
		expect(all.map((d) => d.id)).toEqual(['new']); // 'old' a disparu
	});

	it('efface aussi l’historique de versions (pas de snapshots orphelins)', async () => {
		await db.versions.put({
			id: newId(),
			draftId: 'old',
			name: 'old.md',
			content: 'v1',
			createdAt: 0
		});
		expect(await db.versions.count()).toBe(1);
		const backup: BackupFile = {
			format: BACKUP_FORMAT,
			schemaVersion: 1,
			exportedAt: 0,
			drafts: [draft({ id: 'new', name: 'new.md' })],
			workspaces: [],
			templates: []
		};
		await applyBackup(backup, 'replace');
		// La sauvegarde ne porte pas de versions : `replace` doit vider la table,
		// sinon le snapshot de 'old' (draft disparu) reste orphelin.
		expect(await db.versions.count()).toBe(0);
	});
});

describe('§2.8 - sauvegarde chiffrée', () => {
	it('isEncryptedBackup distingue clair et chiffré', async () => {
		await db.drafts.put(draft({ id: 'd', name: 'd.md', content: 'secret' }));
		const clearJson = serializeBackup(await collectBackup());
		expect(isEncryptedBackup(clearJson)).toBe(false);

		const env = await encryptString(clearJson, 'pw');
		const encText = JSON.stringify(env);
		expect(isEncryptedBackup(encText)).toBe(true);
		expect(isEncryptedBackup('pas du json')).toBe(false);
	});

	it('round-trip : export chiffré → restoreFromText avec passphrase', async () => {
		await db.drafts.put(draft({ id: 'd', name: 'd.md', content: 'contenu chiffré' }));
		const clearJson = serializeBackup(await collectBackup());
		const encText = JSON.stringify(await encryptString(clearJson, 'motdepasse'));

		await clearAll();
		const counts = await restoreFromText(encText, 'replace', 'motdepasse');
		expect(counts.drafts).toBe(1);
		expect((await db.drafts.get('d'))?.content).toBe('contenu chiffré');
	});

	it('restoreFromText sur fichier chiffré sans passphrase → erreur', async () => {
		const env = await encryptString('{"format":"mdsh-backup","schemaVersion":1}', 'pw');
		await expect(restoreFromText(JSON.stringify(env), 'replace')).rejects.toThrow(/passphrase/i);
	});

	it('decryptBackupText restitue le JSON clair', async () => {
		const env = await encryptString('{"hello":"world"}', 'k');
		expect(await decryptBackupText(JSON.stringify(env), 'k')).toBe('{"hello":"world"}');
	});
});

describe('applyBackup - merge', () => {
	it('conserve l’existant et ajoute les nouveaux drafts à la fin', async () => {
		await db.drafts.bulkPut([
			draft({ id: 'a', name: 'a.md', order: 0 }),
			draft({ id: 'b', name: 'b.md', order: 1 })
		]);
		const backup: BackupFile = {
			format: BACKUP_FORMAT,
			schemaVersion: 1,
			exportedAt: 0,
			drafts: [draft({ id: 'c', name: 'c.md', order: 0 })], // order 0 en collision
			workspaces: [],
			templates: []
		};
		await applyBackup(backup, 'merge');
		const all = await db.drafts.orderBy('order').toArray();
		expect(all.map((d) => d.id)).toEqual(['a', 'b', 'c']);
		// 'c' a reçu un order > max existant (1) → 2, pas de collision
		expect(all.find((d) => d.id === 'c')?.order).toBe(2);
	});

	it('écrase le contenu d’un id existant en préservant son order', async () => {
		await db.drafts.put(draft({ id: 'a', name: 'a.md', content: 'avant', order: 5 }));
		const backup: BackupFile = {
			format: BACKUP_FORMAT,
			schemaVersion: 1,
			exportedAt: 0,
			drafts: [draft({ id: 'a', name: 'a.md', content: 'après', order: 99 })],
			workspaces: [],
			templates: []
		};
		await applyBackup(backup, 'merge');
		const a = await db.drafts.get('a');
		expect(a?.content).toBe('après');
		expect(a?.order).toBe(5); // order courant préservé
	});

	it('fusionne workspaces et templates par id', async () => {
		await db.templates.put(template({ id: 't1', name: 'avant' }));
		const backup: BackupFile = {
			format: BACKUP_FORMAT,
			schemaVersion: 1,
			exportedAt: 0,
			drafts: [],
			workspaces: [workspace({ id: 'w1', name: 'WS' })],
			templates: [template({ id: 't1', name: 'après' }), template({ id: 't2', name: 'neuf' })]
		};
		await applyBackup(backup, 'merge');
		expect(await db.workspaces.count()).toBe(1);
		expect((await db.templates.get('t1'))?.name).toBe('après');
		expect(await db.templates.count()).toBe(2);
	});

	it('merge : ajoute plusieurs nouveaux drafts avec des order strictement croissants', async () => {
		await db.drafts.put(draft({ id: 'a', name: 'a.md', order: 3 }));
		const backup: BackupFile = {
			format: BACKUP_FORMAT,
			schemaVersion: 1,
			exportedAt: 0,
			drafts: [
				draft({ id: 'x', name: 'x.md', order: 0 }),
				draft({ id: 'y', name: 'y.md', order: 0 })
			],
			workspaces: [],
			templates: []
		};
		await applyBackup(backup, 'merge');
		const all = await db.drafts.orderBy('order').toArray();
		// existant conservé en tête, nouveaux empilés après max(order)=3
		expect(all.map((d) => d.id)).toEqual(['a', 'x', 'y']);
		expect(all.find((d) => d.id === 'x')?.order).toBe(4);
		expect(all.find((d) => d.id === 'y')?.order).toBe(5);
	});

	it('merge sur une base vide : maxOrder part de -1 → premiers order 0,1', async () => {
		const backup: BackupFile = {
			format: BACKUP_FORMAT,
			schemaVersion: 1,
			exportedAt: 0,
			drafts: [
				draft({ id: 'p', name: 'p.md', order: 42 }),
				draft({ id: 'q', name: 'q.md', order: 42 })
			],
			workspaces: [],
			templates: []
		};
		const counts = await applyBackup(backup, 'merge');
		expect(counts.drafts).toBe(2);
		const all = await db.drafts.orderBy('order').toArray();
		expect(all.map((d) => d.id)).toEqual(['p', 'q']);
		expect(all.find((d) => d.id === 'p')?.order).toBe(0);
		expect(all.find((d) => d.id === 'q')?.order).toBe(1);
	});

	it('propage le compte de rows ignorées (skipped) dans le résultat', async () => {
		const backup: BackupFile = {
			format: BACKUP_FORMAT,
			schemaVersion: 1,
			exportedAt: 0,
			drafts: [draft({ id: 'a', name: 'a.md' })],
			workspaces: [],
			templates: []
		};
		const counts = await applyBackup(backup, 'merge', 3);
		expect(counts.skipped).toBe(3);
		expect(counts.drafts).toBe(1);
	});
});

describe('parseBackup - BackupParseError (messages FR + name)', () => {
	it('JSON invalide : message FR et name BackupParseError', () => {
		try {
			parseBackup('{pas du json');
			throw new Error('aurait dû lever');
		} catch (e) {
			expect(e).toBeInstanceOf(BackupParseError);
			expect((e as BackupParseError).name).toBe('BackupParseError');
			expect((e as BackupParseError).message).toBe(
				'Fichier illisible : ce n’est pas du JSON valide.'
			);
		}
	});

	it('futureVersion interpole le numéro de version dans le message FR', () => {
		const json = JSON.stringify({
			format: BACKUP_FORMAT,
			schemaVersion: BACKUP_SCHEMA_VERSION + 5
		});
		expect(() => parseBackup(json)).toThrow(
			`Sauvegarde créée par une version plus récente de mdsh (schéma v${BACKUP_SCHEMA_VERSION + 5}). Mets l’application à jour.`
		);
	});
});

describe('decryptBackupText - branches d’erreur', () => {
	it('texte non-JSON → BackupParseError (encryptedInvalidJson)', async () => {
		await expect(decryptBackupText('{pas du json', 'k')).rejects.toThrow(BackupParseError);
		await expect(decryptBackupText('{pas du json', 'k')).rejects.toThrow(
			'Fichier chiffré illisible : ce n’est pas du JSON valide.'
		);
	});

	it('JSON valide mais pas une enveloppe chiffrée → BackupParseError (notEncrypted)', async () => {
		await expect(decryptBackupText('{"hello":"world"}', 'k')).rejects.toThrow(BackupParseError);
		await expect(decryptBackupText('{"hello":"world"}', 'k')).rejects.toThrow(
			'Ce fichier n’est pas chiffré.'
		);
	});

	it('enveloppe valide mais mauvaise passphrase → DecryptError', async () => {
		const env = await encryptString('{"hello":"world"}', 'bonpw');
		await expect(decryptBackupText(JSON.stringify(env), 'mauvaispw')).rejects.toThrow();
	});
});

describe('restoreFromText - texte clair', () => {
	it('restaure un backup clair (non chiffré) en mode replace', async () => {
		await db.drafts.put(draft({ id: 'old', name: 'old.md' }));
		const json = serializeBackup({
			format: BACKUP_FORMAT,
			schemaVersion: 1,
			exportedAt: 0,
			drafts: [draft({ id: 'clair', name: 'clair.md', content: 'texte clair' })],
			workspaces: [],
			templates: []
		});
		const counts = await restoreFromText(json, 'replace');
		expect(counts.drafts).toBe(1);
		expect(counts.skipped).toBe(0);
		expect((await db.drafts.get('clair'))?.content).toBe('texte clair');
		expect(await db.drafts.get('old')).toBeUndefined();
	});

	it('remonte le total des rows ignorées à travers restoreFromText', async () => {
		const json = JSON.stringify({
			format: BACKUP_FORMAT,
			schemaVersion: 1,
			drafts: [draft({ id: 'g', name: 'g.md' }), { id: 'bad' }],
			workspaces: [{ id: 'w-bad' }],
			templates: [{ id: 't-bad' }]
		});
		const counts = await restoreFromText(json, 'replace');
		expect(counts.drafts).toBe(1);
		// 1 draft + 1 workspace + 1 template invalides
		expect(counts.skipped).toBe(3);
	});

	it('enveloppe chiffrée + mauvaise passphrase → rejette via restoreFromText', async () => {
		const clearJson = serializeBackup({
			format: BACKUP_FORMAT,
			schemaVersion: 1,
			exportedAt: 0,
			drafts: [draft({ id: 'd', name: 'd.md' })],
			workspaces: [],
			templates: []
		});
		const encText = JSON.stringify(await encryptString(clearJson, 'bonpw'));
		await expect(restoreFromText(encText, 'replace', 'mauvaispw')).rejects.toThrow();
		// rien n’a été appliqué
		expect(await db.drafts.count()).toBe(0);
	});
});

describe('restoreFromFile', () => {
	it('lit un File clair et l’applique', async () => {
		const json = serializeBackup({
			format: BACKUP_FORMAT,
			schemaVersion: 1,
			exportedAt: 0,
			drafts: [draft({ id: 'f', name: 'f.md', content: 'depuis un fichier' })],
			workspaces: [],
			templates: []
		});
		const file = new File([json], 'mdsh-backup.json', { type: 'application/json' });
		// jsdom's File peut ne pas exposer `.text()` (utilisé par restoreFromFile).
		if (typeof file.text !== 'function') {
			Object.defineProperty(file, 'text', { value: async () => json });
		}
		const counts = await restoreFromFile(file, 'replace');
		expect(counts.drafts).toBe(1);
		expect((await db.drafts.get('f'))?.content).toBe('depuis un fichier');
	});
});

describe('parseBackup - validateurs (chaque champ corrompu rejeté)', () => {
	const base = { format: BACKUP_FORMAT, schemaVersion: 1 };

	it('rejette chaque variante de workspace invalide, garde le valide', () => {
		const valid = workspace({ id: 'w-ok' });
		const corrupted = [
			{ ...valid, id: 42 }, // id non string
			{ ...valid, name: null }, // name non string
			{ ...valid, fileIds: 'pas-un-tableau' }, // fileIds non tableau
			{ ...valid, fileIds: ['ok', 7] }, // fileIds avec élément non string
			{ ...valid, activeId: 12 }, // activeId ni null ni string
			{ ...valid, createdAt: 'hier' }, // createdAt non number
			{ ...valid, updatedAt: 'demain' }, // updatedAt non number
			null,
			[],
			'texte'
		];
		const json = JSON.stringify({ ...base, workspaces: [valid, ...corrupted] });
		const parsed = parseBackup(json);
		expect(parsed.workspaces).toHaveLength(1);
		expect(parsed.workspaces[0]?.id).toBe('w-ok');
	});

	it('accepte un workspace dont activeId est explicitement null', () => {
		const json = JSON.stringify({
			...base,
			workspaces: [workspace({ id: 'w', activeId: null })]
		});
		expect(parseBackup(json).workspaces).toHaveLength(1);
	});

	it('rejette chaque variante de template invalide, garde le valide', () => {
		const valid = template({ id: 't-ok' });
		const corrupted = [
			{ ...valid, id: 0 }, // id non string
			{ ...valid, name: 5 }, // name non string
			{ ...valid, content: null }, // content non string
			{ ...valid, builtin: 'oui' }, // builtin non booléen
			{ ...valid, createdAt: '0' }, // createdAt non number
			{ ...valid, updatedAt: '0' }, // updatedAt non number
			undefined
		];
		const json = JSON.stringify({ ...base, templates: [valid, ...corrupted] });
		const parsed = parseBackup(json);
		expect(parsed.templates).toHaveLength(1);
		expect(parsed.templates[0]?.id).toBe('t-ok');
	});

	it('rejette chaque variante de draft invalide, garde le valide', () => {
		const valid = draft({ id: 'd-ok' });
		const corrupted = [
			{ ...valid, id: 1 },
			{ ...valid, name: null },
			{ ...valid, content: 9 },
			{ ...valid, createdAt: '0' },
			{ ...valid, updatedAt: '0' },
			{ ...valid, order: 'premier' }
		];
		const json = JSON.stringify({ ...base, drafts: [valid, ...corrupted] });
		const parsed = parseBackup(json);
		expect(parsed.drafts).toHaveLength(1);
		expect(parsed.drafts[0]?.id).toBe('d-ok');
	});
});

describe('downloadBackup - orchestration DOM', () => {
	let createdAnchor: {
		href: string;
		download: string;
		click: ReturnType<typeof vi.fn>;
		remove: ReturnType<typeof vi.fn>;
	};
	let createObjectURL: ReturnType<typeof vi.fn>;
	let revokeObjectURL: ReturnType<typeof vi.fn>;
	let createElementSpy: ReturnType<typeof vi.spyOn>;
	let appendSpy: ReturnType<typeof vi.spyOn>;
	let capturedBlobs: Blob[];

	beforeEach(() => {
		desktopMocks.isDesktop.mockReturnValue(false);
		desktopMocks.tauriSaveExportBlob.mockResolvedValue(true);
		capturedBlobs = [];
		createdAnchor = {
			href: '',
			download: '',
			click: vi.fn(),
			remove: vi.fn()
		};
		createObjectURL = vi.fn((blob: Blob) => {
			capturedBlobs.push(blob);
			return 'blob:mock-url';
		});
		revokeObjectURL = vi.fn();
		// URL.createObjectURL / revokeObjectURL n’existent pas sous jsdom : on les pose.
		vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
		const realCreate = document.createElement.bind(document);
		createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
			if (tag === 'a') return createdAnchor as unknown as HTMLAnchorElement;
			return realCreate(tag);
		}) as unknown as ReturnType<typeof vi.spyOn>;
		appendSpy = vi
			.spyOn(document.body, 'appendChild')
			.mockImplementation(
				((node: Node) => node) as typeof document.body.appendChild
			) as unknown as ReturnType<typeof vi.spyOn>;
	});

	afterEach(() => {
		createElementSpy.mockRestore();
		appendSpy.mockRestore();
		vi.unstubAllGlobals();
		desktopMocks.isDesktop.mockReturnValue(false);
	});

	it('télécharge un backup clair (.json) avec nom horodaté', async () => {
		await db.drafts.put(draft({ id: 'd', name: 'd.md', content: 'clair' }));
		const ok = await downloadBackup();
		expect(ok).toBe(true);

		expect(createElementSpy).toHaveBeenCalledWith('a');
		expect(createObjectURL).toHaveBeenCalledTimes(1);
		expect(createdAnchor.click).toHaveBeenCalledTimes(1);
		expect(createdAnchor.remove).toHaveBeenCalledTimes(1);
		expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
		expect(createdAnchor.href).toBe('blob:mock-url');
		expect(createdAnchor.download).toMatch(/^mdsh-backup-\d{4}-\d{2}-\d{2}\.json$/);

		// Le contenu du blob est le JSON clair, re-parsable.
		const text = await blobText(capturedBlobs[0]!);
		const parsed = parseBackup(text);
		expect(parsed.drafts.map((x) => x.id)).toEqual(['d']);
	});

	it('ne fait rien (no-op) en contexte sans document (SSR)', async () => {
		await db.drafts.put(draft({ id: 'd', name: 'd.md' }));
		vi.stubGlobal('document', undefined);
		expect(await downloadBackup()).toBe(false);
		// Aucun blob créé : le garde SSR a court-circuité avant tout DOM.
		expect(createObjectURL).not.toHaveBeenCalled();
		expect(createdAnchor.click).not.toHaveBeenCalled();
	});

	it('télécharge un backup chiffré (.encrypted.json) quand une passphrase est fournie', async () => {
		await db.drafts.put(draft({ id: 'd', name: 'd.md', content: 'à protéger' }));
		expect(await downloadBackup('motdepasse')).toBe(true);

		expect(createdAnchor.click).toHaveBeenCalledTimes(1);
		expect(createdAnchor.download).toMatch(/^mdsh-backup-\d{4}-\d{2}-\d{2}\.encrypted\.json$/);

		// Le blob est une enveloppe chiffrée détectée comme telle.
		const text = await blobText(capturedBlobs[0]!);
		expect(isEncryptedBackup(text)).toBe(true);
		// Et déchiffrable → re-parsable avec la bonne passphrase.
		const clear = await decryptBackupText(text, 'motdepasse');
		expect(parseBackup(clear).drafts.map((x) => x.id)).toEqual(['d']);
	});

	it('retourne false si le dialogue desktop est annulé (pas de succès implicite)', async () => {
		desktopMocks.isDesktop.mockReturnValue(true);
		desktopMocks.tauriSaveExportBlob.mockResolvedValue(false);
		await db.drafts.put(draft({ id: 'd', name: 'd.md', content: 'x' }));
		const ok = await downloadBackup();
		expect(ok).toBe(false);
		expect(desktopMocks.tauriSaveExportBlob).toHaveBeenCalledOnce();
		// No browser blob fallback on cancel.
		expect(createObjectURL).not.toHaveBeenCalled();
		expect(createdAnchor.click).not.toHaveBeenCalled();
	});
});
