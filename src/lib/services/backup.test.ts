import * as cryptoHelpers from '../crypto';
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

// jsdom Blob and File objects can omit `.text()`. Use it when available, or use FileReader.
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
		db.versions.clear(),
		db.trashed.clear()
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
	it('collects ordered drafts, workspaces, and templates', async () => {
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

	it('excludes trash and versions', async () => {
		const b = await collectBackup();
		expect(b).not.toHaveProperty('trashed');
		expect(b).not.toHaveProperty('versions');
	});
});

describe('serializeBackup / parseBackup - roundtrip', () => {
	it('parses a serialized backup without changes', async () => {
		await db.drafts.put(draft({ name: 'r.md', content: 'rt' }));
		const original = await collectBackup(999);
		const json = serializeBackup(original);
		const parsed = parseBackup(json);
		expect(parsed).toEqual(original);
	});
});

describe('parseBackup - validation', () => {
	it('rejects invalid JSON', () => {
		expect(() => parseBackup('{not json')).toThrow(BackupParseError);
	});

	it('rejects an object with the wrong format', () => {
		expect(() => parseBackup(JSON.stringify({ format: 'autre', schemaVersion: 1 }))).toThrow(
			/pas une sauvegarde mdsh/
		);
	});

	it('rejects a future schema version', () => {
		const json = JSON.stringify({
			format: BACKUP_FORMAT,
			schemaVersion: BACKUP_SCHEMA_VERSION + 1
		});
		expect(() => parseBackup(json)).toThrow(/version plus récente/);
	});

	it('rejects a missing schema version', () => {
		expect(() => parseBackup(JSON.stringify({ format: BACKUP_FORMAT }))).toThrow(
			/version de schéma/
		);
	});

	it('rejects a non-integer or non-positive schema version', () => {
		for (const bad of [0, -1, 0.5, 1.5]) {
			expect(() =>
				parseBackup(JSON.stringify({ format: BACKUP_FORMAT, schemaVersion: bad }))
			).toThrow(/incohérente/);
		}
	});

	it('rejects missing arrays instead of an empty backup', () => {
		const json = JSON.stringify({ format: BACKUP_FORMAT, schemaVersion: 1 });
		expect(() => parseBackup(json)).toThrow(BackupParseError);
	});

	it('rejects a collection with an invalid draft', () => {
		const good = draft({ id: 'g', name: 'ok.md' });
		const json = JSON.stringify({
			format: BACKUP_FORMAT,
			schemaVersion: 1,
			drafts: [good, { id: 'bad' /* manque les autres champs */ }, null, 42]
		});
		expect(() => parseBackup(json)).toThrow(BackupParseError);
	});
});

describe('applyBackup - replace', () => {
	it('rejects an invalid envelope without deleting documents or history', async () => {
		await db.drafts.put(draft({ id: 'local', content: 'à conserver' }));
		await db.versions.put({
			id: 'version',
			draftId: 'local',
			name: 'doc.md',
			content: 'avant',
			createdAt: 1
		});
		const malformed = JSON.stringify({
			format: BACKUP_FORMAT,
			schemaVersion: 1,
			drafts: {},
			workspaces: null
		});
		await expect(restoreFromText(malformed, 'replace')).rejects.toBeInstanceOf(BackupParseError);
		expect((await db.drafts.get('local'))?.content).toBe('à conserver');
		expect(await db.versions.get('version')).toBeDefined();
	});

	it('rejects duplicate IDs before changes', async () => {
		await db.drafts.put(draft({ id: 'local' }));
		const backup = {
			format: BACKUP_FORMAT,
			schemaVersion: 1,
			exportedAt: 0,
			drafts: [draft({ id: 'same', content: 'a' }), draft({ id: 'same', content: 'b' })],
			workspaces: [],
			templates: []
		} satisfies BackupFile;
		await expect(applyBackup(backup, 'replace')).rejects.toBeInstanceOf(BackupParseError);
		expect(await db.drafts.get('local')).toBeDefined();
	});

	it('replaces all existing state', async () => {
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

	it('keeps a replaced document and history in durable recovery', async () => {
		await db.drafts.put(draft({ id: 'old', name: 'old.md', content: 'courant' }));
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
		expect(await db.versions.count()).toBe(1);
		expect((await db.trashed.get('old'))?.file.content).toBe('courant');
	});
});

describe('§2.8 - encrypted backup', () => {
	it('distinguishes plain and encrypted backups', async () => {
		await db.drafts.put(draft({ id: 'd', name: 'd.md', content: 'secret' }));
		const clearJson = serializeBackup(await collectBackup());
		expect(isEncryptedBackup(clearJson)).toBe(false);

		const env = await encryptString(clearJson, 'pw');
		const encText = JSON.stringify(env);
		expect(isEncryptedBackup(encText)).toBe(true);
		expect(isEncryptedBackup('pas du json')).toBe(false);
	});

	it('restores an encrypted export from text with a passphrase', async () => {
		await db.drafts.put(draft({ id: 'd', name: 'd.md', content: 'contenu chiffré' }));
		const clearJson = serializeBackup(await collectBackup());
		const encText = JSON.stringify(await encryptString(clearJson, 'motdepasse'));

		await clearAll();
		const counts = await restoreFromText(encText, 'replace', 'motdepasse');
		expect(counts.drafts).toBe(1);
		expect((await db.drafts.get('d'))?.content).toBe('contenu chiffré');
	});

	it('rejects encrypted text restoration without a passphrase', async () => {
		const env = await encryptString('{"format":"mdsh-backup","schemaVersion":1}', 'pw');
		await expect(restoreFromText(JSON.stringify(env), 'replace')).rejects.toThrow(/passphrase/i);
	});

	it('returns plain JSON from decryptBackupText', async () => {
		const env = await encryptString('{"hello":"world"}', 'k');
		expect(await decryptBackupText(JSON.stringify(env), 'k')).toBe('{"hello":"world"}');
	});
});

describe('applyBackup - merge', () => {
	it('keeps both contents and maps workspaces without duplicate reimport', async () => {
		await db.drafts.put(draft({ id: 'a', content: 'local récent', createdAt: 1, updatedAt: 2000 }));
		const backup = {
			format: BACKUP_FORMAT,
			schemaVersion: 1,
			exportedAt: 1000,
			drafts: [draft({ id: 'a', content: 'ancien importé', createdAt: 1, updatedAt: 1000 })],
			workspaces: [
				workspace({ id: 'w', fileIds: ['a'], activeId: 'a', createdAt: 1, updatedAt: 1000 })
			],
			templates: []
		} satisfies BackupFile;
		await applyBackup(backup, 'merge');
		const variant = (await db.drafts.toArray()).find((row) => row.id !== 'a');
		expect((await db.drafts.get('a'))?.content).toBe('local récent');
		expect(variant?.content).toBe('ancien importé');
		expect((await db.workspaces.get('w'))?.fileIds).toEqual([variant?.id]);
		expect((await db.workspaces.get('w'))?.activeId).toBe(variant?.id);
		await applyBackup(backup, 'merge');
		expect(await db.drafts.count()).toBe(2);
		expect(await db.workspaces.count()).toBe(1);
	});

	it('keeps existing drafts and adds new drafts at the end', async () => {
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
		// Give 'c' an order greater than the existing maximum of 1. This gives 2 without a collision.
		expect(all.find((d) => d.id === 'c')?.order).toBe(2);
	});

	it('keeps local content and imports a variant without order changes', async () => {
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
		expect(a?.content).toBe('avant');
		expect(a?.order).toBe(5); // order courant préservé
		const imported = (await db.drafts.toArray()).find((row) => row.id !== 'a');
		expect(imported?.content).toBe('après');
		expect(imported?.order).toBe(6);
	});

	it('merges workspaces and templates by ID', async () => {
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
		expect((await db.templates.get('t1'))?.name).toBe('avant');
		expect(await db.templates.count()).toBe(3);
	});

	it('adds new drafts with increasing order during merge', async () => {
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
		// Keep the existing item first. Put new items after max(order), which is 3.
		expect(all.map((d) => d.id)).toEqual(['a', 'x', 'y']);
		expect(all.find((d) => d.id === 'x')?.order).toBe(4);
		expect(all.find((d) => d.id === 'y')?.order).toBe(5);
	});

	it('starts merged draft order at zero in an empty database', async () => {
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

	it('rejects partial restoration without explicit acceptance', async () => {
		const backup: BackupFile = {
			format: BACKUP_FORMAT,
			schemaVersion: 1,
			exportedAt: 0,
			drafts: [draft({ id: 'a', name: 'a.md' })],
			workspaces: [],
			templates: []
		};
		await expect(applyBackup(backup, 'merge', 3)).rejects.toBeInstanceOf(BackupParseError);
		expect(await db.drafts.count()).toBe(0);
	});
});

describe('parseBackup - localized BackupParseError', () => {
	it('returns a French message and BackupParseError name for invalid JSON', () => {
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

	it('inserts the future version number in the French message', () => {
		const json = JSON.stringify({
			format: BACKUP_FORMAT,
			schemaVersion: BACKUP_SCHEMA_VERSION + 5
		});
		expect(() => parseBackup(json)).toThrow(
			`Sauvegarde créée par une version plus récente de mdsh (schéma v${BACKUP_SCHEMA_VERSION + 5}). Mets l’application à jour.`
		);
	});
});

describe('decryptBackupText - error paths', () => {
	it('returns BackupParseError for non-JSON text', async () => {
		await expect(decryptBackupText('{pas du json', 'k')).rejects.toThrow(BackupParseError);
		await expect(decryptBackupText('{pas du json', 'k')).rejects.toThrow(
			'Fichier chiffré illisible : ce n’est pas du JSON valide.'
		);
	});

	it('returns BackupParseError for valid JSON that is not encrypted', async () => {
		await expect(decryptBackupText('{"hello":"world"}', 'k')).rejects.toThrow(BackupParseError);
		await expect(decryptBackupText('{"hello":"world"}', 'k')).rejects.toThrow(
			'Ce fichier n’est pas chiffré.'
		);
	});

	it('returns DecryptError for a valid envelope with an incorrect passphrase', async () => {
		const env = await encryptString('{"hello":"world"}', 'bonpw');
		await expect(decryptBackupText(JSON.stringify(env), 'mauvaispw')).rejects.toThrow();
	});
});

describe('restoreFromText - plain text', () => {
	it('restores a plain backup in replace mode', async () => {
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

	it('rejects partial restoration before changes', async () => {
		const json = JSON.stringify({
			format: BACKUP_FORMAT,
			schemaVersion: 1,
			drafts: [draft({ id: 'g', name: 'g.md' }), { id: 'bad' }],
			workspaces: [{ id: 'w-bad' }],
			templates: [{ id: 't-bad' }]
		});
		await expect(restoreFromText(json, 'replace')).rejects.toBeInstanceOf(BackupParseError);
		expect(await db.drafts.count()).toBe(0);
	});

	it('rejects an encrypted envelope with an incorrect passphrase', async () => {
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
		// No data was applied.
		expect(await db.drafts.count()).toBe(0);
	});
});

describe('restoreFromFile', () => {
	it('reads and applies a plain File', async () => {
		const json = serializeBackup({
			format: BACKUP_FORMAT,
			schemaVersion: 1,
			exportedAt: 0,
			drafts: [draft({ id: 'f', name: 'f.md', content: 'depuis un fichier' })],
			workspaces: [],
			templates: []
		});
		const file = new File([json], 'mdsh-backup.json', { type: 'application/json' });
		// jsdom's File can omit `.text()`, which restoreFromFile uses.
		if (typeof file.text !== 'function') {
			Object.defineProperty(file, 'text', { value: async () => json });
		}
		const counts = await restoreFromFile(file, 'replace');
		expect(counts.drafts).toBe(1);
		expect((await db.drafts.get('f'))?.content).toBe('depuis un fichier');
	});
});

describe('parseBackup - field validators', () => {
	const base = {
		format: BACKUP_FORMAT,
		schemaVersion: 1,
		exportedAt: 0,
		drafts: [],
		workspaces: [],
		templates: []
	};

	it('rejects each invalid workspace variant', () => {
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
		for (const invalid of corrupted) {
			const json = JSON.stringify({ ...base, workspaces: [valid, invalid] });
			expect(() => parseBackup(json)).toThrow(BackupParseError);
		}
	});

	it('accepts a workspace with an explicit null activeId', () => {
		const json = JSON.stringify({
			...base,
			workspaces: [workspace({ id: 'w', activeId: null })]
		});
		expect(parseBackup(json).workspaces).toHaveLength(1);
	});

	it('rejects each invalid template variant', () => {
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
		for (const invalid of corrupted) {
			const json = JSON.stringify({ ...base, templates: [valid, invalid] });
			expect(() => parseBackup(json)).toThrow(BackupParseError);
		}
	});

	it('rejects each invalid draft variant', () => {
		const valid = draft({ id: 'd-ok' });
		const corrupted = [
			{ ...valid, id: 1 },
			{ ...valid, name: null },
			{ ...valid, content: 9 },
			{ ...valid, createdAt: '0' },
			{ ...valid, updatedAt: '0' },
			{ ...valid, order: 'premier' }
		];
		for (const invalid of corrupted) {
			const json = JSON.stringify({ ...base, drafts: [valid, invalid] });
			expect(() => parseBackup(json)).toThrow(BackupParseError);
		}
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
		// jsdom omits URL.createObjectURL and revokeObjectURL. Add them for this test.
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

	it('downloads a plain JSON backup with a dated name', async () => {
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

		// The blob contains plain JSON that can be parsed again.
		const text = await blobText(capturedBlobs[0]!);
		const parsed = parseBackup(text);
		expect(parsed.drafts.map((x) => x.id)).toEqual(['d']);
	});

	it('fails without producing a file when the durability barrier fails', async () => {
		const ensureDurable = vi.fn(async () => {
			throw new Error('IndexedDB indisponible');
		});
		await expect(downloadBackup(undefined, ensureDurable)).rejects.toThrow(
			'IndexedDB indisponible'
		);
		expect(ensureDurable).toHaveBeenCalledOnce();
		expect(createObjectURL).not.toHaveBeenCalled();
		expect(createdAnchor.click).not.toHaveBeenCalled();
	});

	it('does nothing without document during server-side rendering', async () => {
		await db.drafts.put(draft({ id: 'd', name: 'd.md' }));
		vi.stubGlobal('document', undefined);
		expect(await downloadBackup()).toBe(false);
		// The SSR guard returns before DOM access, so it creates no blob.
		expect(createObjectURL).not.toHaveBeenCalled();
		expect(createdAnchor.click).not.toHaveBeenCalled();
	});

	it('downloads an encrypted backup when a passphrase is present', async () => {
		await db.drafts.put(draft({ id: 'd', name: 'd.md', content: 'à protéger' }));
		expect(await downloadBackup('motdepasse')).toBe(true);

		expect(createdAnchor.click).toHaveBeenCalledTimes(1);
		expect(createdAnchor.download).toMatch(/^mdsh-backup-\d{4}-\d{2}-\d{2}\.encrypted\.json$/);

		// The blob is an encrypted envelope and must be detected as one.
		const text = await blobText(capturedBlobs[0]!);
		expect(isEncryptedBackup(text)).toBe(true);
		// The correct passphrase must decrypt the envelope to valid parseable data.
		const clear = await decryptBackupText(text, 'motdepasse');
		expect(parseBackup(clear).drafts.map((x) => x.id)).toEqual(['d']);
	});

	it('rejects download when a document exceeds the restore limit', async () => {
		await db.drafts.put(draft({ content: 'x'.repeat(16 * 1024 * 1024 + 1) }));
		await expect(downloadBackup()).rejects.toThrow(BackupParseError);
		expect(createdAnchor.click).not.toHaveBeenCalled();
		expect(createObjectURL).not.toHaveBeenCalled();
	});

	it('rejects an encrypted envelope larger than 64 MiB before download', async () => {
		const envelope = await encryptString('{}', 'password');
		const encrypt = vi
			.spyOn(cryptoHelpers, 'encryptString')
			.mockResolvedValue({ ...envelope, ct: 'a'.repeat(64 * 1024 * 1024) });
		try {
			await expect(downloadBackup('password')).rejects.toThrow(BackupParseError);
			expect(createdAnchor.click).not.toHaveBeenCalled();
			expect(createObjectURL).not.toHaveBeenCalled();
		} finally {
			encrypt.mockRestore();
		}
	});

	it('backs up more than 300 documents from multiple batches without truncation', async () => {
		await db.drafts.bulkPut(
			Array.from({ length: 301 }, (_, index) => draft({ id: `document-${index}` }))
		);
		expect(await downloadBackup()).toBe(true);
		expect(parseBackup(await blobText(capturedBlobs[0]!)).drafts).toHaveLength(301);
	});

	it('returns false after desktop dialog cancellation', async () => {
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

	it('returns a native error without a browser download', async () => {
		desktopMocks.isDesktop.mockReturnValue(true);
		desktopMocks.tauriSaveExportBlob.mockRejectedValueOnce(new Error('disk conflict'));
		await expect(downloadBackup()).rejects.toThrow('disk conflict');
		expect(createObjectURL).not.toHaveBeenCalled();
		expect(createdAnchor.click).not.toHaveBeenCalled();
	});
});

describe('restore limits before read and changes', () => {
	it('rejects a backup larger than 64 MiB without reading it', async () => {
		const file = {
			size: 64 * 1024 * 1024 + 1,
			arrayBuffer: vi.fn(),
			text: vi.fn()
		} as unknown as File;
		await expect(restoreFromFile(file, 'replace')).rejects.toThrow(BackupParseError);
		expect(file.arrayBuffer).not.toHaveBeenCalled();
		expect(file.text).not.toHaveBeenCalled();
	});
	it('rejects invalid UTF-8 bytes before changes', async () => {
		await db.drafts.put(draft({ id: 'safe' }));
		await expect(
			restoreFromFile(new File([new Uint8Array([0xc3, 0x28])], 'backup.json'), 'replace')
		).rejects.toThrow(BackupParseError);
		expect(await db.drafts.get('safe')).toBeDefined();
	});
	it('rejects more than 3000 documents and binary content', () => {
		const backup = {
			format: BACKUP_FORMAT,
			schemaVersion: 1,
			exportedAt: 0,
			drafts: Array.from({ length: 3001 }, (_, index) => draft({ id: String(index) })),
			workspaces: [],
			templates: []
		};
		expect(() => parseBackup(JSON.stringify(backup))).toThrow(BackupParseError);
		backup.drafts = [draft({ id: 'binary', content: '\0' })];
		expect(() => parseBackup(JSON.stringify(backup))).toThrow(BackupParseError);
	});
	it('rejects one document larger than 16 MiB', () => {
		const backup = {
			format: BACKUP_FORMAT,
			schemaVersion: 1,
			exportedAt: 0,
			drafts: [draft({ content: 'x'.repeat(16 * 1024 * 1024 + 1) })],
			workspaces: [],
			templates: []
		};
		expect(() => parseBackup(JSON.stringify(backup))).toThrow(BackupParseError);
	});
});

describe('strict validation for each saved field', () => {
	it.each([
		['drafts', 'id', ''],
		['drafts', 'name', 42],
		['drafts', 'content', false],
		['drafts', 'createdAt', 'hier'],
		['drafts', 'updatedAt', null],
		['drafts', 'order', '1'],
		['drafts', 'open', 'false'],
		['workspaces', 'id', ''],
		['workspaces', 'name', null],
		['workspaces', 'fileIds', {}],
		['workspaces', 'fileIds', [42]],
		['workspaces', 'activeId', 42],
		['workspaces', 'createdAt', null],
		['workspaces', 'updatedAt', false],
		['templates', 'id', ''],
		['templates', 'name', 42],
		['templates', 'content', null],
		['templates', 'builtin', 1],
		['templates', 'createdAt', false],
		['templates', 'updatedAt', null]
	])('refuse %s.%s invalide', (collection, field, value) => {
		const backup: Record<string, unknown> = {
			format: BACKUP_FORMAT,
			schemaVersion: 1,
			exportedAt: 0,
			drafts: [],
			workspaces: [],
			templates: []
		};
		const original =
			collection === 'drafts' ? draft() : collection === 'workspaces' ? workspace() : template();
		backup[String(collection)] = [{ ...original, [String(field)]: value }];
		expect(() => parseBackup(JSON.stringify(backup))).toThrow(BackupParseError);
	});
	it.each(['drafts', 'workspaces', 'templates'])(
		'refuse une entrée non objet dans %s',
		(collection) => {
			const backup = {
				format: BACKUP_FORMAT,
				schemaVersion: 1,
				exportedAt: 0,
				drafts: [],
				workspaces: [],
				templates: [],
				[collection]: [null]
			};
			expect(() => parseBackup(JSON.stringify(backup))).toThrow(BackupParseError);
		}
	);
});

describe('saved workspace references', () => {
	it.each([
		workspace({ fileIds: ['a', 'a'], activeId: 'a' }),
		workspace({ fileIds: ['a'], activeId: 'absent' }),
		workspace({ fileIds: [''] }),
		workspace({ fileIds: Array.from({ length: 301 }, (_, index) => String(index)) })
	])('refuse doublons, référence vide, sélection incohérente et espace trop grand', (invalid) => {
		expect(() =>
			parseBackup(
				JSON.stringify({
					format: BACKUP_FORMAT,
					schemaVersion: 1,
					exportedAt: 0,
					drafts: [],
					workspaces: [invalid],
					templates: []
				})
			)
		).toThrow(BackupParseError);
	});
	it('also limits total references across workspaces', () => {
		const workspaces = Array.from({ length: 11 }, (_, index) =>
			workspace({ id: String(index), fileIds: Array.from({ length: 300 }, (_, id) => String(id)) })
		);
		expect(() =>
			parseBackup(
				JSON.stringify({
					format: BACKUP_FORMAT,
					schemaVersion: 1,
					exportedAt: 0,
					drafts: [],
					workspaces,
					templates: []
				})
			)
		).toThrow(BackupParseError);
	});
});
