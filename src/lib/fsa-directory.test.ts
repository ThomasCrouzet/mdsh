import { describe, it, expect, afterEach, vi } from 'vitest';
import { pickDirectoryFiles, isDirectoryPickerSupported } from './fsa';

// §2.3 - Teste la collecte récursive de markdown depuis un FileSystemDirectory
// Handle simulé (le picker réel n'existe pas en jsdom). Vérifie : récursion,
// filtre d'extension, exclusion node_modules / dossiers cachés, annulation.

interface FakeFile {
	kind: 'file';
	name: string;
	getFile: () => Promise<{ text: () => Promise<string> }>;
}
interface FakeDir {
	kind: 'directory';
	name: string;
	values: () => AsyncIterableIterator<FakeFile | FakeDir>;
}

function file(name: string, content: string): FakeFile {
	return { kind: 'file', name, getFile: async () => ({ text: async () => content }) };
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
