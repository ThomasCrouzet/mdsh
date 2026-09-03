import { describe, expect, it, vi } from 'vitest';
import { IMPORT_LIMITS } from './config';
import {
	ImportReadError,
	ImportSession,
	readUtf8File,
	validateMarkdownContent
} from './import-limits';

function input(bytes: number[], size = bytes.length): File {
	return {
		name: 'note.md',
		size,
		arrayBuffer: vi.fn(async () => new Uint8Array(bytes).buffer)
	} as unknown as File;
}

describe('budgets et décodage des imports', () => {
	it('refuse la taille par fichier avant toute lecture', async () => {
		const file = input([], IMPORT_LIMITS.maxFileBytes + 1);
		const session = new ImportSession();
		expect(await session.read(file)).toBeNull();
		expect(file.arrayBuffer).not.toHaveBeenCalled();
		expect(session.report.issues).toEqual([{ name: 'note.md', reason: 'file-size' }]);
	});
	it('refuse le dépassement cumulé avant lecture et conserve le budget consommé', async () => {
		const session = new ImportSession();
		for (let i = 0; i < 4; i++) session.reserve(IMPORT_LIMITS.maxFileBytes);
		const file = input([65]);
		expect(await session.read(file)).toBeNull();
		expect(file.arrayBuffer).not.toHaveBeenCalled();
		expect(session.report.bytes).toBe(IMPORT_LIMITS.maxBatchBytes);
		expect(session.report.issues[0]?.reason).toBe('batch-size');
	});
	it('borne à 300 lectures même si les fichiers admis se révèlent invalides', () => {
		const session = new ImportSession();
		for (let i = 0; i < 300; i++) session.reserve(0);
		expect(() => session.reserve(0)).toThrowError(new ImportReadError('file-count'));
	});
	it.each([NaN, -1, 0.5, Infinity])('refuse une taille invalide %s', (size) => {
		expect(() => new ImportSession().reserve(size)).toThrowError(new ImportReadError('file-size'));
	});
	it('décode Unicode valide et conserve tabulations et fins de ligne', async () => {
		const content = '# Écriture\tété\r\n';
		expect(await new ImportSession().read(new File([content], 'note.md'))).toBe(content);
	});
	it('refuse UTF-8 invalide au lieu de remplacer les caractères', async () => {
		const session = new ImportSession();
		expect(await session.read(input([0xc3, 0x28]))).toBeNull();
		expect(session.report.issues[0]?.reason).toBe('encoding');
	});
	it.each([0, 1, 8, 11, 12, 31])('refuse le contrôle binaire %s dans un faux markdown', (code) => {
		expect(() => validateMarkdownContent(`titre${String.fromCharCode(code)}`)).toThrowError(
			new ImportReadError('binary')
		);
	});
	it('refuse une taille qui change pendant la lecture', async () => {
		const session = new ImportSession();
		expect(await session.read(input([65], 2))).toBeNull();
		expect(session.report.issues[0]?.reason).toBe('read');
	});
	it('expose une erreur de lecture et permet de poursuivre le lot', async () => {
		const session = new ImportSession();
		const file = input([65]);
		vi.mocked(file.arrayBuffer).mockRejectedValue(new Error('permission'));
		expect(await session.read(file)).toBeNull();
		expect(await session.read(input([66]))).toBe('B');
		expect(session.report.failed).toBe(1);
	});
	it('ignore le résultat arrivé après annulation sans compter un échec', async () => {
		const controller = new AbortController();
		const session = new ImportSession({ signal: controller.signal });
		const file = input([65]);
		vi.mocked(file.arrayBuffer).mockImplementation(async () => {
			controller.abort();
			return new Uint8Array([65]).buffer;
		});
		expect(await session.read(file)).toBeNull();
		expect(await session.pause()).toBe(false);
		expect(await session.read(input([66]))).toBeNull();
		expect(session.report).toMatchObject({ cancelled: true, failed: 0 });
	});
	it('refuse une lecture directe déjà annulée avant de lire les octets', async () => {
		const controller = new AbortController();
		controller.abort();
		const file = input([65]);
		await expect(
			readUtf8File(file, IMPORT_LIMITS.maxFileBytes, controller.signal)
		).rejects.toMatchObject({ name: 'AbortError' });
		expect(file.arrayBuffer).not.toHaveBeenCalled();
	});
	it('annule également une lecture rejetée et fournit des snapshots indépendants', async () => {
		const controller = new AbortController();
		const onProgress = vi.fn();
		const session = new ImportSession({ signal: controller.signal, onProgress });
		const first = session.publish();
		session.skip();
		session.accept();
		session.fail('x', 'read');
		expect(first).toMatchObject({ processed: 0, issues: [] });
		const file = input([65]);
		vi.mocked(file.arrayBuffer).mockImplementation(async () => {
			controller.abort();
			throw new Error('aborted');
		});
		expect(await session.read(file)).toBeNull();
		expect(session.report.failed).toBe(1);
		expect(onProgress).toHaveBeenCalledTimes(4);
	});
});

describe('lecture FileReader de compatibilité', () => {
	function legacyFile(): File {
		return { name: 'legacy.md', size: 1 } as File;
	}
	it('lit un fichier dans les navigateurs sans arrayBuffer sur File', async () => {
		class Reader {
			result: ArrayBuffer = new Uint8Array([65]).buffer;
			error = null;
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			onabort: (() => void) | null = null;
			readAsArrayBuffer() {
				this.onload?.();
			}
			abort() {
				this.onabort?.();
			}
		}
		vi.stubGlobal('FileReader', Reader);
		try {
			expect(await new ImportSession().read(legacyFile())).toBe('A');
		} finally {
			vi.unstubAllGlobals();
		}
	});
	it('classe une erreur FileReader comme erreur de lecture', async () => {
		class Reader {
			result = null;
			error = new Error('disk');
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			onabort: (() => void) | null = null;
			readAsArrayBuffer() {
				this.onerror?.();
			}
			abort() {
				this.onabort?.();
			}
		}
		vi.stubGlobal('FileReader', Reader);
		try {
			const session = new ImportSession();
			expect(await session.read(legacyFile())).toBeNull();
			expect(session.report.issues[0]?.reason).toBe('read');
		} finally {
			vi.unstubAllGlobals();
		}
	});
	it('interrompt FileReader via AbortSignal et détache son écouteur', async () => {
		const abort = vi.fn();
		class Reader {
			result = null;
			error = null;
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			onabort: (() => void) | null = null;
			readAsArrayBuffer() {}
			abort() {
				abort();
				this.onabort?.();
			}
		}
		vi.stubGlobal('FileReader', Reader);
		const controller = new AbortController();
		try {
			const session = new ImportSession({ signal: controller.signal });
			const reading = session.read(legacyFile());
			controller.abort();
			expect(await reading).toBeNull();
			expect(abort).toHaveBeenCalledOnce();
			expect(session.report.cancelled).toBe(true);
		} finally {
			vi.unstubAllGlobals();
		}
	});
	it('capture une exception synchrone du démarrage de FileReader', async () => {
		class Reader {
			result = null;
			error = null;
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			onabort: (() => void) | null = null;
			readAsArrayBuffer() {
				throw new Error('unsupported');
			}
			abort() {
				this.onabort?.();
			}
		}
		vi.stubGlobal('FileReader', Reader);
		try {
			const session = new ImportSession();
			expect(await session.read(legacyFile())).toBeNull();
			expect(session.report.issues[0]?.reason).toBe('read');
		} finally {
			vi.unstubAllGlobals();
		}
	});
	it('ignore une callback de progression défaillante sans annuler les données', () => {
		const session = new ImportSession({
			onProgress: () => {
				throw new Error('UI detached');
			}
		});
		expect(() => session.accept()).not.toThrow();
		expect(session.report.imported).toBe(1);
	});
});
