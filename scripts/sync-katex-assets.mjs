import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { format } from 'prettier';

const rootDir = process.cwd();
const sourceDir = resolve(rootDir, 'node_modules/katex/dist');
const targetDir = resolve(rootDir, 'static/katex');
const checkOnly = process.argv.includes('--check');

const fontFiles = [
	'KaTeX_AMS-Regular.woff2',
	'KaTeX_Caligraphic-Bold.woff2',
	'KaTeX_Caligraphic-Regular.woff2',
	'KaTeX_Main-Bold.woff2',
	'KaTeX_Main-BoldItalic.woff2',
	'KaTeX_Main-Italic.woff2',
	'KaTeX_Main-Regular.woff2',
	'KaTeX_Math-BoldItalic.woff2',
	'KaTeX_Math-Italic.woff2',
	'KaTeX_Size1-Regular.woff2',
	'KaTeX_Size2-Regular.woff2',
	'KaTeX_Size3-Regular.woff2',
	'KaTeX_Size4-Regular.woff2',
	'KaTeX_Typewriter-Regular.woff2'
];

const excludedFamilies = [
	{
		family: 'KaTeX_Fraktur',
		comment:
			'/* @font-face Fraktur (Bold, Regular) supprimés : `\\mathfrak{}` rare, fallback navigateur. */'
	},
	{
		family: 'KaTeX_SansSerif',
		comment:
			'/* @font-face SansSerif (Bold, Italic, Regular) supprimés : `\\textsf{}` rare, fallback navigateur. */'
	},
	{
		family: 'KaTeX_Script',
		comment: '/* @font-face Script (Regular) supprimé : `\\mathscr{}` rare, fallback navigateur. */'
	}
];

function stripExcludedFontFaces(sourceCss) {
	let css = sourceCss;

	for (const { family, comment } of excludedFamilies) {
		const familyPattern = new RegExp(
			`@font-face\\{(?=[^}]*font-family:(?:["']?)${family}(?:["']?);)[^}]*\\}`,
			'g'
		);
		let occurrence = 0;
		css = css.replace(familyPattern, () => (occurrence++ === 0 ? `\n${comment}\n` : ''));

		if (occurrence === 0) {
			throw new Error(`Famille KaTeX introuvable dans le CSS source : ${family}`);
		}
	}

	return css;
}

function keepWoff2Sources(sourceCss) {
	let replacementCount = 0;
	const css = sourceCss.replace(
		/src:url\(([^)]*\.woff2)\) format\("woff2"\),url\([^)]*\.woff\) format\("woff"\),url\([^)]*\.ttf\) format\("truetype"\)/g,
		(_match, woff2Path) => {
			replacementCount += 1;
			return `src:url(${woff2Path}) format("woff2")`;
		}
	);

	if (replacementCount !== fontFiles.length) {
		throw new Error(
			`Nombre de déclarations de polices KaTeX inattendu : ${replacementCount} au lieu de ${fontFiles.length}`
		);
	}

	return css;
}

async function buildCss() {
	const sourceCss = await readFile(resolve(sourceDir, 'katex.min.css'), 'utf8');
	const optimizedCss = keepWoff2Sources(stripExcludedFontFaces(sourceCss));

	return format(optimizedCss, {
		parser: 'css',
		useTabs: true,
		singleQuote: true,
		trailingComma: 'none',
		printWidth: 100
	});
}

async function filesMatch(sourcePath, targetPath) {
	const [source, target] = await Promise.all([readFile(sourcePath), readFile(targetPath)]);
	return source.equals(target);
}

async function checkAssets(expectedCss) {
	const cssPath = resolve(targetDir, 'katex.min.css');
	const cssMatches = (await readFile(cssPath, 'utf8')) === expectedCss;
	const mismatchedFonts = [];

	for (const fontFile of fontFiles) {
		const sourcePath = resolve(sourceDir, 'fonts', fontFile);
		const targetPath = resolve(targetDir, 'fonts', fontFile);
		if (!(await filesMatch(sourcePath, targetPath))) {
			mismatchedFonts.push(fontFile);
		}
	}

	if (!cssMatches || mismatchedFonts.length > 0) {
		const details = [
			!cssMatches ? 'CSS statique différent du paquet installé' : null,
			mismatchedFonts.length > 0 ? `polices différentes : ${mismatchedFonts.join(', ')}` : null
		]
			.filter(Boolean)
			.join(' ; ');
		throw new Error(
			`Ressources KaTeX désynchronisées (${details}). Lancez npm run sync:katex-assets.`
		);
	}
}

async function writeAssets(expectedCss) {
	await mkdir(resolve(targetDir, 'fonts'), { recursive: true });
	await writeFile(resolve(targetDir, 'katex.min.css'), expectedCss);

	await Promise.all(
		fontFiles.map((fontFile) =>
			copyFile(resolve(sourceDir, 'fonts', fontFile), resolve(targetDir, 'fonts', fontFile))
		)
	);
}

const expectedCss = await buildCss();

if (checkOnly) {
	await checkAssets(expectedCss);
	console.log('Ressources KaTeX synchronisées.');
} else {
	await writeAssets(expectedCss);
	console.log('Ressources KaTeX mises à jour.');
}
