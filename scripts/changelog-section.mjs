#!/usr/bin/env node
// Extracts the Keep-a-Changelog section for a tag/version from CHANGELOG.md.
// Used by desktop.yml so tauri-action updateRelease() cannot write an empty body.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * @param {string} markdown
 * @param {string} versionOrTag e.g. `v1.3.0` or `1.3.0`
 * @returns {string}
 */
export function extractChangelogSection(markdown, versionOrTag) {
	const version = String(versionOrTag).trim().replace(/^v/i, '');
	if (!version) {
		throw new Error('changelog-section: missing version');
	}
	const heading = `## [${version}]`;
	const start = markdown.indexOf(heading);
	if (start < 0) {
		throw new Error(`changelog-section: no CHANGELOG heading ${heading}`);
	}
	const next = markdown.indexOf('\n## [', start + heading.length);
	const section = (next < 0 ? markdown.slice(start) : markdown.slice(start, next)).trim();
	if (!section) {
		throw new Error(`changelog-section: empty section for ${version}`);
	}
	return `${section}\n`;
}

/**
 * @param {string} versionOrTag
 * @param {string} changelogPath
 * @returns {string}
 */
export function readChangelogSection(versionOrTag, changelogPath) {
	const markdown = readFileSync(changelogPath, 'utf8');
	return extractChangelogSection(markdown, versionOrTag);
}

function isMain() {
	const entry = process.argv[1];
	return typeof entry === 'string' && import.meta.url === pathToFileURL(entry).href;
}

if (isMain()) {
	const versionOrTag = process.argv[2];
	if (!versionOrTag) {
		console.error('usage: node scripts/changelog-section.mjs <tag-or-version>');
		process.exit(2);
	}
	const changelogPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'CHANGELOG.md');
	process.stdout.write(readChangelogSection(versionOrTag, changelogPath));
}
