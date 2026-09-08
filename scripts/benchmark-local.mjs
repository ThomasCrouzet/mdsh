import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { chromium } from '@playwright/test';

const projectRoot = resolve(import.meta.dirname, '..');
const defaultPort = 4183;
const contentTypes = {
	'.css': 'text/css; charset=utf-8',
	'.html': 'text/html; charset=utf-8',
	'.ico': 'image/x-icon',
	'.js': 'application/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.webmanifest': 'application/manifest+json',
	'.webp': 'image/webp',
	'.woff2': 'font/woff2'
};

function parseArguments(args) {
	const options = { runs: 9, output: null, url: null };
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === '--runs') options.runs = Number(args[++index]);
		else if (arg === '--output') options.output = args[++index] ?? null;
		else if (arg === '--url') options.url = args[++index] ?? null;
		else throw new Error(`Unknown argument: ${arg}`);
	}
	if (!Number.isInteger(options.runs) || options.runs < 3 || options.runs > 50) {
		throw new Error('--runs must be an integer from 3 through 50.');
	}
	if (options.output) {
		if (!isAbsolute(options.output)) throw new Error('--output must be an absolute path.');
		const fromProject = relative(projectRoot, resolve(options.output));
		if (!fromProject.startsWith(`..${sep}`) && fromProject !== '..') {
			throw new Error('--output must be outside the repository.');
		}
	}
	return options;
}

function percentile(values, ratio) {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function summarize(values) {
	return {
		runs: values.length,
		medianMs: Number(percentile(values, 0.5).toFixed(1)),
		p95Ms: Number(percentile(values, 0.95).toFixed(1)),
		minMs: Number(Math.min(...values).toFixed(1)),
		maxMs: Number(Math.max(...values).toFixed(1))
	};
}

async function waitForServer(url) {
	for (let attempt = 0; attempt < 120; attempt += 1) {
		try {
			const response = await fetch(url);
			if (response.ok) return;
		} catch {
			// The preview server is still starting.
		}
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
	}
	throw new Error(`Preview server did not start: ${url}`);
}

async function startStaticServer() {
	const buildRoot = resolve(projectRoot, 'build');
	const indexHtml = await readFile(resolve(buildRoot, 'index.html'));
	const htmlText = indexHtml.toString('utf8');
	const manifestHref = htmlText.match(/href="([^"]*manifest\.webmanifest)"/)?.[1] ?? '';
	const basePath = manifestHref.startsWith('/')
		? manifestHref.slice(0, manifestHref.lastIndexOf('/'))
		: '';
	const port = Number(process.env.BENCHMARK_PORT ?? defaultPort);
	const server = createServer(async (request, response) => {
		try {
			const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
			if (basePath && !requestUrl.pathname.startsWith(`${basePath}/`)) {
				response.writeHead(302, { Location: `${basePath}/` });
				response.end();
				return;
			}
			let relativePath = requestUrl.pathname.slice(basePath.length).replace(/^\/+/, '');
			if (!relativePath) relativePath = 'index.html';
			let path = resolve(buildRoot, decodeURIComponent(relativePath));
			const fromBuild = relative(buildRoot, path);
			if (!fromBuild || fromBuild.startsWith(`..${sep}`) || isAbsolute(fromBuild)) {
				throw new Error('Request path is outside build/.');
			}
			try {
				if (!(await stat(path)).isFile()) throw new Error('Not a file.');
			} catch {
				path = resolve(buildRoot, 'index.html');
			}
			const body = path.endsWith('index.html') ? indexHtml : await readFile(path);
			response.writeHead(200, {
				'Cache-Control': 'no-store',
				'Content-Type': contentTypes[extname(path)] ?? 'application/octet-stream'
			});
			response.end(body);
		} catch (error) {
			response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
			response.end(error instanceof Error ? error.message : String(error));
		}
	});
	await new Promise((resolvePromise, reject) => {
		server.once('error', reject);
		server.listen(port, '127.0.0.1', resolvePromise);
	});
	const url = `http://127.0.0.1:${port}${basePath}/`;
	await waitForServer(url);
	return { server, url };
}

async function waitForShell(page) {
	await page.locator('.mdsh-shell[aria-busy="false"]:not([inert])').waitFor({
		state: 'visible',
		timeout: 30_000
	});
}

async function measureStartup(browser, url, runs) {
	const coldStart = [];
	const cachedRestart = [];
	for (let run = 0; run < runs; run += 1) {
		const context = await browser.newContext({ locale: 'en-US' });
		const page = await context.newPage();
		const coldStartAt = performance.now();
		await page.goto(url);
		await waitForShell(page);
		coldStart.push(performance.now() - coldStartAt);

		await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
		for (let attempt = 0; attempt < 3; attempt += 1) {
			if (await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) break;
			await page.reload();
			await waitForShell(page);
		}
		const cachedStartAt = performance.now();
		await page.reload();
		await waitForShell(page);
		cachedRestart.push(performance.now() - cachedStartAt);
		await context.close();
	}
	return { coldStart, cachedRestart };
}

function benchmarkContent(index) {
	const paragraph = `Draft ${index} contains local Markdown, tags, [[links]], tables, and code. `;
	return `---\ntitle: Benchmark ${index}\ntags: [benchmark, corpus]\n---\n\n# Draft ${index}\n\n${paragraph.repeat(145)}`;
}

async function seedCorpus(page, count) {
	const drafts = Array.from({ length: count }, (_, index) => ({
		id: `benchmark-${String(index).padStart(3, '0')}`,
		name: `benchmark-${String(index).padStart(3, '0')}.md`,
		content: benchmarkContent(index),
		createdAt: 1_700_000_000_000 + index,
		updatedAt: 1_700_000_000_000 + index,
		order: index,
		open: true
	}));
	await page.evaluate(async (rows) => {
		await new Promise((resolvePromise, reject) => {
			const request = indexedDB.open('mdsh');
			request.onerror = () => reject(request.error);
			request.onsuccess = () => {
				const database = request.result;
				const transaction = database.transaction('drafts', 'readwrite');
				const store = transaction.objectStore('drafts');
				store.clear();
				for (const row of rows) store.put(row);
				transaction.oncomplete = () => {
					database.close();
					resolvePromise(undefined);
				};
				transaction.onerror = () => reject(transaction.error);
			};
		});
		localStorage.setItem('mdsh:activeId', rows[0].id);
		localStorage.setItem('mdsh:mode', 'source');
	}, drafts);
}

async function measureCorpus(browser, url, runs) {
	const context = await browser.newContext({ locale: 'en-US' });
	const page = await context.newPage();
	await page.goto(url);
	await waitForShell(page);
	await seedCorpus(page, 300);

	const corpusReload = [];
	for (let run = 0; run < runs; run += 1) {
		const startedAt = performance.now();
		await page.reload();
		await waitForShell(page);
		await page.locator('.cm-content').first().waitFor({ state: 'visible', timeout: 30_000 });
		corpusReload.push(performance.now() - startedAt);
	}

	const sourceInsertion = [];
	const editor = page.locator('.cm-content').first();
	await editor.click();
	for (let run = 0; run < runs; run += 1) {
		const startedAt = performance.now();
		await page.keyboard.insertText(` sample-${run}-text`);
		sourceInsertion.push(performance.now() - startedAt);
	}

	const readingMode = [];
	const wysiwygMode = [];
	for (let run = 0; run < runs; run += 1) {
		let startedAt = performance.now();
		await page.locator('button[data-mode="read"]').click();
		await page.locator('.mdsh-preview').waitFor({ state: 'visible', timeout: 30_000 });
		readingMode.push(performance.now() - startedAt);

		await page.locator('button[data-mode="source"]').click();
		await page.locator('.cm-content').first().waitFor({ state: 'visible', timeout: 30_000 });
		startedAt = performance.now();
		await page.locator('button[data-mode="wysiwyg"]').click();
		await page.locator('.ProseMirror').waitFor({ state: 'visible', timeout: 30_000 });
		wysiwygMode.push(performance.now() - startedAt);

		await page.locator('button[data-mode="source"]').click();
		await page.locator('.cm-content').first().waitFor({ state: 'visible', timeout: 30_000 });
	}
	await context.close();
	return { corpusReload, sourceInsertion, readingMode, wysiwygMode };
}

async function main() {
	const options = parseArguments(process.argv.slice(2));
	let preview = null;
	const url = options.url ?? (preview = await startStaticServer()).url;
	let browser = null;
	try {
		browser = await chromium.launch();
		const startup = await measureStartup(browser, url, options.runs);
		const corpus = await measureCorpus(browser, url, options.runs);
		const samples = { ...startup, ...corpus };
		const summary = Object.fromEntries(
			Object.entries(samples).map(([name, values]) => [name, summarize(values)])
		);
		const result = {
			generatedAt: new Date().toISOString(),
			url,
			corpus: { drafts: 300, bytesPerDraft: Buffer.byteLength(benchmarkContent(0)) },
			summary,
			samples
		};
		console.table(summary);
		if (options.output) {
			await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
			console.log(`Wrote benchmark data to ${options.output}.`);
		}
	} finally {
		await browser?.close();
		preview?.server.closeAllConnections();
		preview?.server.close();
	}
}

await main();
