import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { extractChangelogSection, readChangelogSection } from '../../scripts/changelog-section.mjs';

const changelogPath = resolve(process.cwd(), 'CHANGELOG.md');
const scriptPath = resolve(process.cwd(), 'scripts/changelog-section.mjs');

describe('extractChangelogSection (shipped CHANGELOG parser)', () => {
	const changelog = readFileSync(changelogPath, 'utf8');

	it('returns the live 1.3.0 notes from CHANGELOG.md', () => {
		const notes = extractChangelogSection(changelog, 'v1.3.0');
		expect(notes.startsWith('## [1.3.0]')).toBe(true);
		expect(notes).toContain('BLACKSITE');
		expect(notes).toContain('nanoid');
		expect(notes).toContain('untitled');
		expect(notes).toContain('sanitizer');
		expect(notes).not.toContain('## [1.2.3]');
	});

	it('accepts a bare version and matches readChangelogSection', () => {
		expect(readChangelogSection('1.2.3', changelogPath)).toBe(
			extractChangelogSection(changelog, '1.2.3')
		);
		expect(readChangelogSection('1.2.3', changelogPath)).toContain('checklists');
	});

	it('throws when the version is missing from CHANGELOG.md', () => {
		expect(() => extractChangelogSection(changelog, 'v0.0.0')).toThrow(/no CHANGELOG heading/);
	});
});

describe('scripts/changelog-section.mjs CLI', () => {
	it('prints the same 1.3.0 section the workflow will pass as releaseBody', () => {
		const out = execFileSync(process.execPath, [scriptPath, 'v1.3.0'], {
			encoding: 'utf8',
			cwd: process.cwd()
		});
		expect(out).toBe(readChangelogSection('v1.3.0', changelogPath));
		expect(out).toContain('BLACKSITE');
	});
});
