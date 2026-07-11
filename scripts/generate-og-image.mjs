#!/usr/bin/env node
/**
 * Génère `static/og-image.png` (1200×630) à partir de `static/og-image.svg`.
 *
 * Pourquoi un PNG ? Twitter/X et Slack acceptent SVG, mais Facebook et
 * LinkedIn ne supportent que PNG/JPEG pour les Open Graph cards. On garde
 * donc les deux : SVG = source de vérité éditable, PNG = format universel.
 *
 * Dépendance : `@resvg/resvg-js` (rendu SVG natif Rust, ~5 Mo, hors deps
 * runtime du projet - installer manuellement avant la prochaine release
 * publique si on veut régénérer le PNG depuis le SVG) :
 *
 *   npm install --no-save --legacy-peer-deps @resvg/resvg-js
 *   node scripts/generate-og-image.mjs
 *
 * En l'absence de cette dépendance, le script affiche un message clair
 * et exit 0 (non bloquant pour le build).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const svgPath = resolve(__dirname, '../static/og-image.svg');
const pngPath = resolve(__dirname, '../static/og-image.png');

let Resvg;
try {
	({ Resvg } = await import('@resvg/resvg-js'));
} catch {
	console.error(
		'[og-image] @resvg/resvg-js manquant - installer via :\n' +
			'  npm install --no-save --legacy-peer-deps @resvg/resvg-js\n' +
			'Puis relancer : node scripts/generate-og-image.mjs'
	);
	process.exit(0);
}

const svg = readFileSync(svgPath, 'utf8');

const resvg = new Resvg(svg, {
	background: '#14161a',
	fitTo: { mode: 'width', value: 1200 },
	font: {
		// Le serveur GitHub n'aura aucune des polices system-ui / SF Mono ;
		// on laisse resvg utiliser les fallbacks du système où on génère
		// l'image (idéalement une machine macOS pour le rendu SF Mono).
		loadSystemFonts: true
	}
});

const pngData = resvg.render().asPng();
writeFileSync(pngPath, pngData);

console.log(`[og-image] PNG 1200×630 écrit : ${pngPath} (${pngData.byteLength} octets)`);
