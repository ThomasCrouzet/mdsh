import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

/** @typedef {{ fileName: string, imports: string[], moduleIds: string[], isEntry: boolean }} Chunk */
/** @param {Record<string, Chunk>} chunks @param {string[]} roots */
export function staticClosure(chunks, roots) {
	const seen = new Set();
	const pending = [...roots];
	while (pending.length) {
		const filename = pending.pop();
		if (!filename || seen.has(filename)) continue;
		const chunk = chunks[filename];
		if (!chunk) throw new Error(`Dépendance absente du graphe : ${filename}`);
		seen.add(filename);
		pending.push(...chunk.imports);
	}
	return [...seen].sort();
}

/** @param {Record<string, Chunk>} chunks @param {string[]} roots @param {(file: string) => Uint8Array} read */
export function measureGraph(chunks, roots, read) {
	const files = staticClosure(chunks, roots);
	let raw = 0;
	let gzip = 0;
	for (const filename of files) {
		const bytes = read(filename);
		raw += bytes.length;
		gzip += gzipSync(bytes).length;
	}
	return { files: files.length, raw, gzip };
}

/** @returns {import('vite').Plugin} */
export function bundleGraphPlugin() {
	return {
		name: 'bundle-graph-budget',
		generateBundle(_options, output) {
			/** @type {Record<string, Chunk>} */
			const chunks = {};
			for (const item of Object.values(output)) {
				if (item.type !== 'chunk' || !item.fileName.startsWith('_app/')) continue;
				chunks[item.fileName] = {
					fileName: item.fileName,
					imports: item.imports,
					moduleIds: item.moduleIds,
					isEntry: item.isEntry
				};
			}
			if (!Object.keys(chunks).length) return;
			// Le manifeste contient uniquement les fichiers produits et leurs arêtes.
			const modes = {
				read: ['/src/lib/render/markdown.ts'],
				source: [
					'@codemirror/state/',
					'@codemirror/view/',
					'@codemirror/lang-markdown/',
					'@codemirror/commands/',
					'@codemirror/language/',
					'@codemirror/search/'
				],
				wysiwyg: ['@milkdown/crepe/lib/esm/index.js']
			};
			/** @type {Record<string, string[]>} */
			const roots = {
				boot: Object.values(chunks)
					.filter((chunk) => chunk.isEntry)
					.map((chunk) => chunk.fileName)
			};
			for (const [mode, fragments] of Object.entries(modes)) {
				roots[mode] = Object.values(chunks)
					.filter((chunk) =>
						chunk.moduleIds.some((id) =>
							fragments.some((part) => id.replace(/\\/g, '/').includes(part))
						)
					)
					.map((chunk) => chunk.fileName);
				if (!roots[mode].length) throw new Error(`Racine de mode absente : ${mode}`);
			}
			const graph = Object.fromEntries(
				Object.entries(chunks).map(([name, chunk]) => [name, { imports: chunk.imports }])
			);
			this.emitFile({
				type: 'asset',
				fileName: '.vite/bundle-graph.json',
				source: JSON.stringify({ chunks: graph, roots })
			});
		}
	};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const root = resolve('.svelte-kit/output/client');
	const { chunks, roots } = JSON.parse(
		readFileSync(resolve(root, '.vite/bundle-graph.json'), 'utf8')
	);
	const budgets = JSON.parse(readFileSync('.bundle-budgets.json', 'utf8'));
	let failed = false;
	for (const [mode, limit] of Object.entries(budgets)) {
		if (!roots[mode]?.length) throw new Error(`Budget sans racine : ${mode}`);
		const result = measureGraph(chunks, roots[mode], (file) => readFileSync(resolve(root, file)));
		console.log(`${mode}: ${result.files} JS, ${result.gzip} octets gzip / ${limit}`);
		if (result.gzip > Number(limit)) failed = true;
	}
	if (failed) process.exitCode = 1;
}
