import { describe, it, expect, afterEach, vi } from 'vitest';
import { pickDirectoryFiles, isDirectoryPickerSupported } from './fsa';

// §2.3 - Test recursive Markdown collection from a simulated FileSystemDirectory
// handle. jsdom does not provide the picker. Verify traversal, extension filters,
// excluded directories, and cancellation.

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
	it('returns true when window.showDirectoryPicker exists', () => {
		installPicker(async () => dir('root', []));
		expect(isDirectoryPickerSupported()).toBe(true);
	});
	it('returns false otherwise', () => {
		installPicker(undefined);
		expect(isDirectoryPickerSupported()).toBe(false);
	});
});

describe('pickDirectoryFiles', () => {
	it('collects supported text files recursively and ignores other files', async () => {
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

	it('ignores node_modules and hidden directories', async () => {
		const root = dir('root', [
			file('keep.md', 'ok'),
			dir('node_modules', [file('dep.md', 'NON')]),
			dir('.git', [file('hook.md', 'NON')])
		]);
		installPicker(async () => root);

		const { files } = await pickDirectoryFiles();
		expect(files.map((f) => f.name)).toEqual(['keep.md']);
	});

	it('returns an empty list after AbortError cancellation', async () => {
		installPicker(async () => {
			throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
		});
		const { files } = await pickDirectoryFiles();
		expect(files).toEqual([]);
	});

	it('returns an empty list when the picker is unavailable', async () => {
		installPicker(undefined);
		const { files, truncated } = await pickDirectoryFiles();
		expect(files).toEqual([]);
		expect(truncated).toBe(false);
	});
});

describe('bounded directory import', () => {
	it('imports 300 notes and reports the next note without reading it', async () => {
		const entries = Array.from({ length: 301 }, (_, index) => file(`${index}.md`, '# Note'));
		entries[300]!.getFile = vi.fn(entries[300]!.getFile);
		installPicker(async () => dir('root', entries));
		const result = await pickDirectoryFiles();
		expect(result.files).toHaveLength(300);
		expect(result.truncated).toBe(true);
		expect(result.report.issues[0]?.reason).toBe('file-count');
		expect(entries[300]!.getFile).not.toHaveBeenCalled();
	});
	it('continues after an unreadable file and a binary Markdown file', async () => {
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
	it('cancels traversal from progress and keeps notes that are already read', async () => {
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
	it('reports excessive depth and picker errors', async () => {
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
