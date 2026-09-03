import { describe, it, expect, afterEach, vi } from 'vitest';
import { pickDirectoryFiles, isDirectoryPickerSupported } from './fsa';

// §2.3 - Teste la collecte récursive de markdown depuis un FileSystemDirectory
// Handle simulé (le picker réel n'existe pas en jsdom). Vérifie : récursion,
// filtre d'extension, exclusion node_modules / dossiers cachés, annulation.

interface FakeFile {
	kind: 'file';
	name: string;
	getFile: () => Promise<File>;
}
interface FakeDir {
	kind: 'directory';
	name: string;
	values: () => AsyncIterableIterator<FakeFile | FakeDir>;
}

function file(name: string, content: string): FakeFile {
	return { kind: 'file', name, getFile: async () => new File([content], name) };
}
function dir(name: string, children: Array<FakeFile | FakeDir>): FakeDir {
	return {
		kind: 'directory',
		name,
		async *values() {
			for (const c of children) yield c;
		}
	};
}

function installPicker(impl: (() => Promise<unknown>) | undefined) {
	if (impl) {
		(window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = vi.fn(impl);
	} else {
		delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
	}
}

afterEach(() => {
	delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
});

describe('isDirectoryPickerSupported', () => {
	it('vrai quand window.showDirectoryPicker existe', () => {
		installPicker(async () => dir('root', []));
		expect(isDirectoryPickerSupported()).toBe(true);
	});
	it('faux sinon', () => {
		installPicker(undefined);
		expect(isDirectoryPickerSupported()).toBe(false);
	});
});

describe('pickDirectoryFiles', () => {
	it('collecte récursivement les .md / .markdown / .txt, ignore le reste', async () => {
		const root = dir('root', [
			file('a.md', '# A'),
			file('photo.png', 'binaire'),
			file('notes.txt', 'texte'),
			dir('sub', [file('b.markdown', 'B'), file('c.mdx', 'C')])
		]);
		installPicker(async () => root);

		const { files, truncated } = await pickDirectoryFiles();
		const names = files.map((f) => f.name).sort();
		expect(names).toEqual(['a.md', 'b.markdown', 'c.mdx', 'notes.txt']);
		expect(files.find((f) => f.name === 'a.md')?.content).toBe('# A');
		expect(truncated).toBe(false);
	});

	it('ignore node_modules et les dossiers cachés', async () => {
		const root = dir('root', [
			file('keep.md', 'ok'),
			dir('node_modules', [file('dep.md', 'NON')]),
			dir('.git', [file('hook.md', 'NON')])
		]);
		installPicker(async () => root);

		const { files } = await pickDirectoryFiles();
		expect(files.map((f) => f.name)).toEqual(['keep.md']);
	});

	it('retourne vide sur annulation (AbortError)', async () => {
		installPicker(async () => {
			throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
		});
		const { files } = await pickDirectoryFiles();
		expect(files).toEqual([]);
	});

	it('retourne vide si le picker n’est pas supporté', async () => {
		installPicker(undefined);
		const { files, truncated } = await pickDirectoryFiles();
		expect(files).toEqual([]);
		expect(truncated).toBe(false);
	});
});

describe('import de dossiers borné', () => {
	it('importe 300 notes et signale la 301e sans la lire', async () => {
		const entries = Array.from({ length: 301 }, (_, index) => file(`${index}.md`, '# Note'));
		entries[300]!.getFile = vi.fn(entries[300]!.getFile);
		installPicker(async () => dir('root', entries));
		const result = await pickDirectoryFiles();
		expect(result.files).toHaveLength(300);
		expect(result.truncated).toBe(true);
		expect(result.report.issues[0]?.reason).toBe('file-count');
		expect(entries[300]!.getFile).not.toHaveBeenCalled();
	});
	it('poursuit après fichier illisible et faux markdown binaire', async () => {
		const broken = file('broken.md', '');
		broken.getFile = vi.fn().mockRejectedValue(new Error('permission'));
		installPicker(async () =>
			dir('root', [broken, file('binary.md', '\0'), file('good.md', 'ok')])
		);
		const result = await pickDirectoryFiles();
		expect(result.files.map((entry) => entry.name)).toEqual(['good.md']);
		expect(result.report.failed).toBe(2);
		expect(result.truncated).toBe(true);
	});
	it('annule le parcours depuis la progression en conservant les notes déjà lues', async () => {
		const controller = new AbortController();
		installPicker(async () => dir('root', [file('one.md', '1'), file('two.md', '2')]));
		const result = await pickDirectoryFiles({
			signal: controller.signal,
			onProgress: (report) => {
				if (report.imported === 1) controller.abort();
			}
		});
		expect(result.files).toHaveLength(1);
		expect(result.report.cancelled).toBe(true);
		expect(result.truncated).toBe(true);
	});
	it('signale une arborescence trop profonde et remonte les erreurs du sélecteur', async () => {
		let nested = dir('leaf', [file('deep.md', 'x')]);
		for (let i = 0; i < 9; i++) nested = dir(`level${i}`, [nested]);
		installPicker(async () => nested);
		expect((await pickDirectoryFiles()).report.issues[0]?.reason).toBe('depth');
		installPicker(async () => {
			throw new Error('permission');
		});
		await expect(pickDirectoryFiles()).rejects.toThrow('permission');
	});
});
