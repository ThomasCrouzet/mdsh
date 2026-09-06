#!/usr/bin/env node
/**
 * Create static/og-image.png (1200x630) from static/og-image.svg.
 *
 * Twitter/X and Slack accept SVG. Facebook and LinkedIn require PNG/JPEG for Open Graph cards.
 * Keep SVG as the editable source and PNG for use across platforms.
 *
 * The script needs @resvg/resvg-js for native Rust SVG rendering (about 5 MB).
 * It is not a runtime dependency. Install it before a public release if the PNG needs regeneration:
 *
 *   npm install --no-save --legacy-peer-deps @resvg/resvg-js
 *   node scripts/generate-og-image.mjs
 *
 * If the dependency is absent, report it and exit with status 0. Do not block the build.
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
		'[og-image] @resvg/resvg-js is missing. Install it with:\n' +
			'  npm install --no-save --legacy-peer-deps @resvg/resvg-js\n' +
			'Then run: node scripts/generate-og-image.mjs'
	);
	process.exit(0);
}

const svg = readFileSync(svgPath, 'utf8');

const resvg = new Resvg(svg, {
	background: '#14161a',
	fitTo: { mode: 'width', value: 1200 },
	font: {
		// The GitHub server does not have system-ui or SF Mono fonts.
		// Let resvg use local system fallbacks. Prefer macOS for SF Mono rendering.
		loadSystemFonts: true
	}
});

const pngData = resvg.render().asPng();
writeFileSync(pngPath, pngData);

console.log(`[og-image] PNG 1200×630 written: ${pngPath} (${pngData.byteLength} bytes)`);
