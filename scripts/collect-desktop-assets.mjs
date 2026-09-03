import { createHash } from 'node:crypto';
import {
	copyFileSync,
	constants,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @param {string} root @returns {string[]} */
function walk(root) {
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		if (entry.isSymbolicLink() || entry.name.endsWith('.app')) return [];
		const path = join(root, entry.name);
		return entry.isDirectory() ? walk(path) : entry.isFile() ? [path] : [];
	});
}

/** @param {string} input @param {string} output @param {{ sha: string, tag: string }} expected */
export function collectDesktopAssets(input, output, expected) {
	if (!/^[a-f0-9]{40}$/.test(expected.sha) || !/^v\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(expected.tag)) {
		throw new Error('Identité source invalide');
	}
	const candidates = walk(input).filter((path) =>
		/\.(?:dmg|AppImage|deb|rpm|msi)$|-setup\.exe$|^sbom-(?:npm|cargo)\.cdx\.json$|^desktop-source\.json$/.test(
			basename(path)
		)
	);
	const names = candidates.map((path) => basename(path));
	if (new Set(names).size !== names.length) throw new Error('Collision de noms dans les artefacts');
	const sourcePath = candidates.find((path) => basename(path) === 'desktop-source.json');
	if (!sourcePath) throw new Error('Manifeste source absent');
	const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
	if (
		source.sha !== expected.sha ||
		source.tag !== expected.tag ||
		`v${source.version}` !== expected.tag
	) {
		throw new Error('Les artefacts ne correspondent pas à la source annoncée');
	}
	for (const pattern of [
		/aarch64\.dmg$/,
		/x64\.dmg$/,
		/\.AppImage$/,
		/\.deb$/,
		/\.rpm$/,
		/-setup\.exe$/,
		/\.msi$/,
		/^sbom-npm\.cdx\.json$/,
		/^sbom-cargo\.cdx\.json$/
	]) {
		if (!names.some((name) => pattern.test(name)))
			throw new Error(`Artefact requis absent : ${pattern}`);
	}
	mkdirSync(output, { recursive: true });
	const checksums = candidates
		.sort((a, b) => basename(a).localeCompare(basename(b)))
		.map((path) => {
			const name = basename(path);
			if (/[\r\n]/.test(name)) throw new Error('Nom de fichier invalide');
			copyFileSync(path, join(output, name), constants.COPYFILE_EXCL);
			return `${createHash('sha256').update(readFileSync(path)).digest('hex')}  ${name}`;
		});
	writeFileSync(join(output, 'SHA256SUMS'), `${checksums.join('\n')}\n`, { flag: 'wx' });
	return names;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	collectDesktopAssets(
		process.argv[2] ?? 'downloaded-assets',
		process.argv[3] ?? 'release-assets',
		{
			sha: process.env.SOURCE_SHA ?? '',
			tag: process.env.RELEASE_TAG ?? ''
		}
	);
}
