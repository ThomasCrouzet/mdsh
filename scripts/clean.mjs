import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const recoveryRoot = resolve(projectRoot, '..', '.markdown-tool-clean-recovery');
const cleanTargets = [
	'build',
	'.svelte-kit',
	'node_modules/.vite',
	'test-results',
	'playwright-report',
	'src-tauri/target'
];

function safeProjectPath(relativePath) {
	const path = resolve(projectRoot, relativePath);
	const fromProject = relative(projectRoot, path);
	if (!fromProject || fromProject.startsWith(`..${sep}`) || isAbsolute(fromProject)) {
		throw new Error(`Unsafe clean target: ${relativePath}`);
	}
	return path;
}

async function pathExists(path) {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (error?.code === 'ENOENT') return false;
		throw error;
	}
}

function batchName() {
	return `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
}

export async function moveCleanTargets({ dryRun = false } = {}) {
	const existing = [];
	for (const relativePath of cleanTargets) {
		const source = safeProjectPath(relativePath);
		if (await pathExists(source)) existing.push({ relativePath, source });
	}
	if (existing.length === 0) return { batch: null, moved: [] };
	if (dryRun) return { batch: null, moved: existing.map(({ relativePath }) => relativePath) };

	const batch = resolve(recoveryRoot, batchName());
	const moved = [];
	for (const item of existing) {
		const destination = resolve(batch, item.relativePath);
		await mkdir(resolve(destination, '..'), { recursive: true });
		await rename(item.source, destination);
		moved.push(item.relativePath);
	}
	await writeFile(
		resolve(batch, 'manifest.json'),
		`${JSON.stringify({ projectRoot, moved }, null, 2)}\n`,
		'utf8'
	);
	return { batch, moved };
}

async function latestBatch() {
	let names;
	try {
		names = await readdir(recoveryRoot);
	} catch (error) {
		if (error?.code === 'ENOENT') return null;
		throw error;
	}
	return names.sort().at(-1) ?? null;
}

export async function restoreCleanTargets(requestedBatch) {
	const name = requestedBatch ?? (await latestBatch());
	if (!name || name.includes('/') || name.includes('\\')) {
		throw new Error('No valid clean recovery batch was selected.');
	}
	const batch = resolve(recoveryRoot, name);
	const manifest = JSON.parse(await readFile(resolve(batch, 'manifest.json'), 'utf8'));
	if (manifest.projectRoot !== projectRoot || !Array.isArray(manifest.moved)) {
		throw new Error('The clean recovery manifest does not match this project.');
	}

	for (const relativePath of manifest.moved) {
		if (!cleanTargets.includes(relativePath))
			throw new Error(`Unexpected recovery target: ${relativePath}`);
		if (await pathExists(safeProjectPath(relativePath))) {
			throw new Error(`Restore target already exists: ${relativePath}`);
		}
	}
	for (const relativePath of [...manifest.moved].reverse()) {
		const destination = safeProjectPath(relativePath);
		await mkdir(resolve(destination, '..'), { recursive: true });
		await rename(resolve(batch, relativePath), destination);
	}
	return { batch, restored: manifest.moved };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
	const args = process.argv.slice(2);
	if (args[0] === '--restore') {
		const result = await restoreCleanTargets(args[1]);
		console.log(`Restored ${result.restored.length} path(s) from ${result.batch}.`);
	} else {
		const dryRun = args[0] === '--dry-run';
		if (args.length > (dryRun ? 1 : 0))
			throw new Error('Usage: clean.mjs [--dry-run | --restore [batch]]');
		const result = await moveCleanTargets({ dryRun });
		if (result.moved.length === 0) console.log('No clean targets exist.');
		else if (dryRun) console.log(`Would move: ${result.moved.join(', ')}`);
		else console.log(`Moved ${result.moved.length} path(s) to ${result.batch}.`);
	}
}
