// Exécute le vrai binaire dans un profil dédié via le WebDriver embarqué de test.
// Aucun serveur de test ni permission supplémentaire n'entre dans les installateurs.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const binary = resolve(
	process.env.NATIVE_BINARY ??
		`src-tauri/target/debug/mdsh${process.platform === 'win32' ? '.exe' : ''}`
);
const port = Number(process.env.TAURI_WEBDRIVER_PORT ?? 4457);
const endpoint = `http://127.0.0.1:${port}`;
const output = resolve('native-test-results');
mkdirSync(output, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), 'mdsh-native-'));
const title = `Native ${Date.now()}`;
const fixture = join(temp, `${title} été.md`);
const image = `data:image/png;base64,${readFileSync(resolve('static/pwa-192x192.png')).toString('base64')}`;
writeFileSync(
	fixture,
	`# ${title}\n\nTexte Unicode été.\n\n![Image](${image})\n\n$e^{i\\pi}+1=0$\n\n\`\`\`mermaid\ngraph LR\nA --> B\n\`\`\`\n`
);
const log = openSync(join(output, 'application.log'), 'w');
/** @type {import('node:child_process').ChildProcess | undefined} */
let app;
let session = '';
/** @type {Record<string, unknown>} */
const results = {
	platform: process.platform,
	arch: process.arch,
	binary,
	source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
	checks: []
};
/** @param {string} name */
const passed = (name) => {
	/** @type {string[]} */ (results.checks).push(name);
	console.log(`OK ${name}`);
};
/** @param {string} path @param {unknown} [body] @param {string} [method] */
async function request(path, body, method = 'POST') {
	const response = await fetch(`${endpoint}${path}`, {
		method,
		headers: { 'content-type': 'application/json' },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
		signal: AbortSignal.timeout(30_000)
	});
	const data = await response.json();
	if (!response.ok || data.value?.error) throw new Error(JSON.stringify(data));
	return data.value;
}
/** @param {string} script @param {unknown[]} [args] */
const execute = (script, args = []) =>
	request(`/session/${session}/execute/sync`, { script, args });
/** @param {string} script @param {unknown[]} [args] */
const executeAsync = (script, args = []) =>
	request(`/session/${session}/execute/async`, { script, args });
/** @param {() => Promise<unknown>} check @param {string} label @param {number} [timeout] */
async function until(check, label, timeout = 30_000) {
	const deadline = Date.now() + timeout;
	let last;
	while (Date.now() < deadline) {
		try {
			const value = await check();
			if (value) return value;
		} catch (error) {
			last = error;
		}
		await delay(150);
	}
	throw new Error(`Timeout ${label}: ${String(last ?? '')}`);
}
/** @param {string} selector */
async function click(selector) {
	await until(
		() =>
			execute(
				'const element = document.querySelector(arguments[0]); if (!element || !element.getClientRects().length) return false; element.click(); return true;',
				[selector]
			),
		`click ${selector}`,
		45_000
	);
}

function launch() {
	app = spawn(binary, [fixture], {
		stdio: ['ignore', log, log],
		env: { ...process.env, TAURI_WEBDRIVER_PORT: String(port) }
	});
	app.on('error', (error) => console.error(error));
}
async function connect() {
	await until(() => request('/status', undefined, 'GET'), 'WebDriver startup');
	const created = await request('/session', {
		capabilities: { alwaysMatch: { 'wdio:tauriServiceOptions': { windowLabel: 'main' } } }
	});
	session = created.sessionId;
	results.runtime = created.capabilities;
	await until(
		() =>
			execute(
				'return [...document.querySelectorAll("input")].some(node => node.value.includes(arguments[0]))',
				[title]
			),
		'cold association acknowledged',
		45_000
	);
	await until(
		() => execute('return !!document.querySelector("button[data-mode=source]")'),
		'document opened'
	);
}
async function drafts() {
	return executeAsync(
		`const done = arguments[arguments.length - 1]; const req = indexedDB.open('mdsh'); req.onerror = () => done([]); req.onsuccess = () => { const db = req.result; const q = db.transaction('drafts').objectStore('drafts').getAll(); q.onsuccess = () => { db.close(); done(q.result); }; };`
	);
}
try {
	launch();
	await connect();
	assert.equal(await execute('return !!window.__TAURI_INTERNALS__'), true);
	const identifier = await executeAsync(
		`const done = arguments[arguments.length - 1]; window.__TAURI__.app.getIdentifier().then(done);`
	);
	assert.equal(identifier, 'io.github.thomascrouzet.mdsh.smoke');
	passed('isolated native profile and cold file association');
	await until(
		async () =>
			(await drafts()).some((/** @type {{content: string}} */ item) =>
				item.content.includes(title)
			),
		'opened file durably stored'
	);
	await execute("localStorage.setItem('mdsh:locale', 'fr');");
	await request(`/session/${session}/refresh`, {}).catch(() => {});
	await until(
		() => execute('return !!document.querySelector("button[data-mode=source]")'),
		'reload'
	);
	await click('button[data-mode="source"]');
	await until(
		() =>
			execute('return document.querySelector(".cm-content")?.textContent?.includes(arguments[0])', [
				title
			]),
		'source text'
	);
	passed('native source editor');
	const before = await drafts();
	assert.equal(
		before.filter((/** @type {{ content: string }} */ d) => d.content.includes(title)).length,
		1
	);
	const second = spawn(binary, [fixture], {
		stdio: ['ignore', log, log],
		env: { ...process.env, TAURI_WEBDRIVER_PORT: String(port) }
	});
	await Promise.race([
		once(second, 'exit'),
		delay(10_000).then(() => {
			throw new Error('Second instance did not exit');
		})
	]);
	await delay(500);
	assert.equal(
		(await drafts()).filter((/** @type {{ content: string }} */ d) => d.content.includes(title))
			.length,
		1
	);
	passed('single instance and file delivery without duplicates');
	await click('button[data-mode="wysiwyg"]');
	await until(
		() => execute('return !!document.querySelector(".milkdown .ProseMirror")'),
		'visual editor',
		45_000
	);
	passed('native WYSIWYG loads');
	await click('button[data-mode="read"]');
	await until(
		() =>
			execute(
				'return document.querySelector(".mdsh-preview img")?.naturalWidth > 0 && !!document.querySelector(".mdsh-preview .katex") && !!document.querySelector(".mdsh-preview .mermaid-block svg")'
			),
		'images math diagram',
		45_000
	);
	passed('native read images math diagram');
	const screenshot = await request(`/session/${session}/screenshot`, undefined, 'GET');
	writeFileSync(join(output, 'read.png'), Buffer.from(screenshot, 'base64'));
	// La préparation réelle est conservée. Le dialogue OS est remplacé seulement
	// au dernier appel pour permettre au pilote de produire le PDF automatiquement.
	await execute(
		'window.__nativePrintCalled = false; window.print = () => { window.__nativePrintCalled = true; };'
	);
	await click('button[aria-label="Exporter en PDF"]');
	await until(
		() => execute('return window.__nativePrintCalled === true'),
		'native print preparation',
		45_000
	);
	assert.equal(
		await execute(
			'return document.getElementById("mdsh-native-print")?.shadowRoot?.querySelector("img")?.naturalWidth'
		),
		192
	);
	passed('native print uses top window with decoded image');
	// WKPDFConfiguration capture l'écran plutôt que le média print. La feuille
	// de tirage est activée pour cette capture, le contenu reste celui du produit.
	await execute(
		`const style = document.createElement('style'); style.textContent = 'body > :not(#mdsh-native-print){display:none!important} #mdsh-native-print{position:static!important;width:auto!important} html,body{height:auto!important;overflow:visible!important}'; document.head.append(style);`
	);
	const pdf = await request(`/session/${session}/print`, { background: true });
	const bytes = Buffer.from(pdf, 'base64');
	assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
	assert.ok(bytes.length > 10_000);
	const pdfStructure = bytes.toString('latin1');
	assert.equal((pdfStructure.match(/\/Type\s*\/Page\b/g) ?? []).length, 1);
	assert.ok((pdfStructure.match(/\/Subtype\s*\/Image\b/g) ?? []).length >= 1);
	writeFileSync(join(output, 'native.pdf'), bytes);
	passed('native WebView render capture contains the image');
	await request(`/session/${session}/refresh`, {}).catch(() => {});
	await until(
		() => execute('return !!document.querySelector("button[data-mode=source]")'),
		'reload after print'
	);
	await click('button[data-mode="wysiwyg"]');
	await until(
		() => execute('return !!document.querySelector(".milkdown .ProseMirror")'),
		'WYSIWYG before close',
		45_000
	);
	await click('.milkdown .ProseMirror');
	await execute(
		`const node = document.querySelector('.milkdown .ProseMirror'); const range = document.createRange(); range.selectNodeContents(node); range.collapse(false); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);`
	);
	const editable = await request(`/session/${session}/element`, {
		using: 'css selector',
		value: '.milkdown .ProseMirror'
	});
	await request(
		`/session/${session}/element/${editable['element-6066-11e4-a52e-4f735466cecf']}/value`,
		{ text: '\nPersisted before native close.' }
	);

	const closed = once(/** @type {import('node:child_process').ChildProcess} */ (app), 'exit');
	// Ferme immédiatement, sans attendre le debounce : le produit doit attendre.
	await executeAsync(
		`const done = arguments[arguments.length - 1]; window.__TAURI__.core.invoke('desktop_smoke_request_close').then(() => done(true), error => done({ error: String(error) }));`
	).catch(() => {});
	await Promise.race([
		closed,
		delay(15_000).then(() => {
			throw new Error('Native close blocked');
		})
	]);
	app = undefined;
	session = '';
	launch();
	await connect();
	await until(
		async () =>
			(await drafts()).some(
				(/** @type {{ content: string }} */ d) =>
					d.content.includes(title) && d.content.includes('Persisted before native close.')
			),
		'durable content on relaunch'
	);
	passed('immediate native WYSIWYG close waits for durable save and relaunch');
	assert.ok(readFileSync(fixture, 'utf8').includes(title));
	results.passed = true;
} catch (error) {
	results.error = String(error);
	if (session) {
		try {
			results.page = await execute(
				'return { text: document.body.innerText, editors: [...document.querySelectorAll(".cm-content")].map(node => node.textContent), inputs: [...document.querySelectorAll("input")].map(node => ({name:node.getAttribute("aria-label"),value:node.value})) };'
			);
		} catch {
			/* La fenêtre peut déjà être fermée. */
		}
	}
	throw error;
} finally {
	try {
		writeFileSync(join(output, 'results.json'), JSON.stringify(results, null, 2));
	} finally {
		if (app?.pid) app.kill();
	}
}
