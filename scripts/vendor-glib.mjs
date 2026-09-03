import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = '0.18.5';
const archiveUrl = `https://static.crates.io/crates/glib/glib-${version}.crate`;
const archiveSha256 = '233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5';
const targetDir = join(rootDir, 'src-tauri/vendor/glib');
const patchPath = join(rootDir, 'patches/glib/variant-str-iter.patch');
const args = process.argv.slice(2);
const mode = args.shift();
const archivePath = args[0] === '--archive' && args.length === 2 ? resolve(args[1]) : undefined;

if (!['--check', '--write'].includes(mode) || (args.length > 0 && !archivePath)) {
	throw new Error('Usage : node scripts/vendor-glib.mjs --check|--write [--archive fichier.crate]');
}

function run(command, commandArgs, cwd) {
	const result = spawnSync(command, commandArgs, { cwd, encoding: 'utf8' });
	if (result.error || result.status !== 0) {
		throw new Error(`${command} a échoué : ${result.error?.message ?? result.stderr}`);
	}
}

async function listFiles(directory, prefix = '') {
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			files.push(...(await listFiles(join(directory, entry.name), relative)));
		} else if (entry.isFile()) {
			files.push(relative);
		} else {
			throw new Error(`Type de fichier inattendu : ${relative}`);
		}
	}
	return files.sort();
}

async function verifyFiles(expectedDir) {
	const expected = await listFiles(expectedDir);
	const actual = await listFiles(targetDir);
	if (JSON.stringify(expected) !== JSON.stringify(actual)) {
		throw new Error('Inventaire vendor différent de la source officielle corrigée.');
	}
	for (const file of expected) {
		const [source, target] = await Promise.all([
			readFile(join(expectedDir, file)),
			readFile(join(targetDir, file))
		]);
		if (!source.equals(target)) throw new Error(`Contenu vendor différent : ${file}`);
	}
	return expected.length;
}

const temporaryDir = await mkdtemp(join(tmpdir(), 'mdsh-vendor-glib-'));
try {
	let archive;
	if (archivePath) {
		archive = await readFile(archivePath);
	} else {
		const response = await fetch(archiveUrl, { signal: AbortSignal.timeout(30_000) });
		if (!response.ok) throw new Error(`Téléchargement impossible : HTTP ${response.status}`);
		archive = Buffer.from(await response.arrayBuffer());
	}
	if (createHash('sha256').update(archive).digest('hex') !== archiveSha256) {
		throw new Error('SHA256 de l’archive glib incorrect.');
	}
	const downloadedPath = join(temporaryDir, 'glib.crate');
	await writeFile(downloadedPath, archive);
	run('tar', ['-xzf', downloadedPath, '-C', temporaryDir], temporaryDir);
	const extractedDir = join(temporaryDir, `glib-${version}`);
	run('git', ['apply', '--check', patchPath], extractedDir);
	run('git', ['apply', patchPath], extractedDir);
	if (mode === '--write') {
		await mkdir(dirname(targetDir), { recursive: true });
		const previousDir = join(temporaryDir, 'previous');
		let hadPrevious = false;
		try {
			await rename(targetDir, previousDir);
			hadPrevious = true;
		} catch (error) {
			if (error.code !== 'ENOENT') throw error;
		}
		try {
			await cp(extractedDir, targetDir, { recursive: true });
		} catch (error) {
			await rm(targetDir, { recursive: true, force: true });
			if (hadPrevious) await rename(previousDir, targetDir);
			throw error;
		}
	}
	const count = await verifyFiles(extractedDir);
	process.stdout.write(
		`glib ${version} : ${count} fichiers vérifiés, archive SHA256 et patch conformes.\n`
	);
} finally {
	await rm(temporaryDir, { recursive: true, force: true });
}
