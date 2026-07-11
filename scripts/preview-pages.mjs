// Mini serveur statique pour tester en local le build comme s'il était servi
// par GitHub Pages sous le sous-chemin `/mdsh/`. Utile pour reproduire les
// régressions de paths absolus avant qu'elles atteignent la prod.
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

console.log('🔨 Build avec BASE_PATH=/mdsh...');
execSync('npm run build', {
	stdio: 'inherit',
	env: { ...process.env, BASE_PATH: '/mdsh' }
});

const ROOT = resolve('build');
const PREFIX = '/mdsh';
const PORT = 4173;
const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'application/javascript',
	'.mjs': 'application/javascript',
	'.css': 'text/css',
	'.json': 'application/json',
	'.webmanifest': 'application/manifest+json',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.webp': 'image/webp',
	'.woff2': 'font/woff2',
	'.ico': 'image/x-icon',
	'.txt': 'text/plain; charset=utf-8'
};

const server = createServer(async (req, res) => {
	const url = req.url ?? '/';
	// Redirige racine + tout chemin hors prefix vers /mdsh/ pour simuler GH Pages.
	if (!url.startsWith(PREFIX)) {
		res.writeHead(302, { Location: PREFIX + url });
		res.end();
		return;
	}
	let path = url.slice(PREFIX.length).split('?')[0];
	if (path === '' || path === '/') path = '/index.html';
	const fsPath = normalize(join(ROOT, path));
	// Garde-fou contre traversal : on refuse tout chemin qui sort de build/.
	if (!fsPath.startsWith(ROOT)) {
		res.writeHead(403);
		res.end('Forbidden');
		return;
	}
	try {
		const s = await stat(fsPath);
		if (s.isDirectory()) throw new Error('directory');
		const buf = await readFile(fsPath);
		res.writeHead(200, {
			'Content-Type': TYPES[extname(fsPath)] ?? 'application/octet-stream',
			'Cache-Control': 'no-store'
		});
		res.end(buf);
	} catch {
		// SPA fallback : on sert index.html pour toute route inconnue.
		try {
			const buf = await readFile(join(ROOT, 'index.html'));
			res.writeHead(200, {
				'Content-Type': 'text/html; charset=utf-8',
				'Cache-Control': 'no-store'
			});
			res.end(buf);
		} catch {
			res.writeHead(404);
			res.end('Not found');
		}
	}
});

server.listen(PORT, () => {
	console.log(`✓ Servi sur http://localhost:${PORT}${PREFIX}/`);
	console.log('  Ctrl+C pour arrêter.');
});
