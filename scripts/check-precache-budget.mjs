import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

const projectRoot = resolve(import.meta.dirname, '..');

export function extractPrecacheUrls(serviceWorker) {
	const marker = 'precacheAndRoute([';
	const start = serviceWorker.indexOf(marker);
	if (start === -1) throw new Error('The service worker has no Workbox precache manifest.');

	const arrayStart = start + marker.length - 1;
	let depth = 0;
	let quote = null;
	let escaped = false;
	let arrayEnd = -1;
	for (let index = arrayStart; index < serviceWorker.length; index += 1) {
		const character = serviceWorker[index];
		if (quote) {
			if (escaped) escaped = false;
			else if (character === '\\') escaped = true;
			else if (character === quote) quote = null;
			continue;
		}
		if (character === '"' || character === "'") quote = character;
		else if (character === '[') depth += 1;
		else if (character === ']' && --depth === 0) {
			arrayEnd = index;
			break;
		}
	}
	if (arrayEnd === -1) throw new Error('The Workbox precache manifest is incomplete.');

	const manifest = serviceWorker.slice(arrayStart + 1, arrayEnd);
	const urls = [...manifest.matchAll(/\burl:(?:"([^"]+)"|'([^']+)')/g)].map(
		(match) => match[1] ?? match[2]
	);
	if (urls.length === 0) throw new Error('The Workbox precache manifest is empty.');
	return urls;
}

async function locateBuildFile(buildDir, url) {
	const pathname = new URL(url, 'https://mdsh.invalid/').pathname;
	if (pathname.endsWith('/')) {
		const path = resolve(buildDir, 'index.html');
		return { path, bytes: await readFile(path) };
	}

	const relativePath = decodeURIComponent(pathname).replace(/^\/+/, '');
	const candidates = [relativePath];
	const firstSlash = relativePath.indexOf('/');
	if (firstSlash !== -1) candidates.push(relativePath.slice(firstSlash + 1));

	for (const candidate of candidates) {
		const path = resolve(buildDir, candidate);
		const fromBuild = relative(buildDir, path);
		if (!fromBuild || fromBuild.startsWith(`..${sep}`) || isAbsolute(fromBuild)) continue;
		try {
			return { path, bytes: await readFile(path) };
		} catch (error) {
			if (error?.code !== 'ENOENT') throw error;
		}
	}
	throw new Error(`The precache entry has no build file: ${url}`);
}

export async function measurePrecache(buildDir) {
	const serviceWorker = await readFile(resolve(buildDir, 'sw.js'), 'utf8');
	const urls = extractPrecacheUrls(serviceWorker);
	const uniqueUrls = new Set(urls);
	if (uniqueUrls.size !== urls.length)
		throw new Error('The Workbox precache manifest has duplicate URLs.');

	let gzipBytes = 0;
	for (const url of urls) {
		const { bytes } = await locateBuildFile(buildDir, url);
		gzipBytes += gzipSync(bytes).length;
	}
	return { entries: urls.length, gzipBytes };
}

export async function checkPrecacheBudget({ buildDir, budgetFile }) {
	const budgets = JSON.parse(await readFile(budgetFile, 'utf8'));
	const measured = await measurePrecache(buildDir);
	const failed =
		measured.entries > budgets.precacheEntries || measured.gzipBytes > budgets.precacheGzipBytes;
	return { budgets, measured, failed };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
	const result = await checkPrecacheBudget({
		buildDir: resolve(projectRoot, 'build'),
		budgetFile: resolve(projectRoot, '.pwa-budgets.json')
	});
	console.log(
		`precache: ${result.measured.entries} entries / ${result.budgets.precacheEntries}, ` +
			`${result.measured.gzipBytes} gzip bytes / ${result.budgets.precacheGzipBytes}`
	);
	if (result.failed) process.exitCode = 1;
}
