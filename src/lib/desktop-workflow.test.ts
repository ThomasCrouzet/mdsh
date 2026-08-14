import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/** Slice one top-level GitHub Actions job block from the workflow file. */
function jobBlock(yml: string, name: string): string {
	const start = yml.search(new RegExp(`^  ${name}:\\s*$`, 'm'));
	if (start < 0) throw new Error(`job ${name} missing from desktop.yml`);
	const fromName = yml.slice(start);
	const next = fromName.slice(2).search(/\n {2}[A-Za-z][\w-]*:/);
	return next < 0 ? fromName : fromName.slice(0, next + 2);
}

describe('desktop.yml attach-policy contract', () => {
	const yml = readFileSync(resolve(process.cwd(), '.github/workflows/desktop.yml'), 'utf8');
	const resolveJob = jobBlock(yml, 'resolve-release-meta');
	const buildJob = jobBlock(yml, 'build-desktop');

	it('keeps windows-latest in the matrix and resolves notes off that runner', () => {
		expect(buildJob).toMatch(/platform:\s*windows-latest/);
		expect(resolveJob).toMatch(/runs-on:\s*ubuntu-22\.04/);
		expect(resolveJob).not.toMatch(/windows-latest/);
		expect(resolveJob).not.toMatch(/strategy:/);
		expect(resolveJob).toContain('scripts/desktop-release-meta.mjs');
		expect(resolveJob).toContain('run: node scripts/desktop-release-meta.mjs');
		expect(buildJob).not.toContain('scripts/desktop-release-meta.mjs');
		expect(buildJob).not.toContain('set -euo pipefail');
		expect(buildJob).not.toContain('$GITHUB_OUTPUT');
		expect(buildJob).not.toMatch(/\$\(/);
	});

	it('wires tauri-action to resolver notes/id and never regenerates notes', () => {
		expect(buildJob).toMatch(/needs:\s*\[validate-desktop,\s*resolve-release-meta\]/);
		expect(buildJob).toMatch(
			/releaseBody:\s*\$\{\{\s*needs\.resolve-release-meta\.outputs\.notes\s*\}\}/
		);
		expect(buildJob).toMatch(
			/releaseId:\s*\$\{\{\s*needs\.resolve-release-meta\.outputs\.id\s*\}\}/
		);
		expect(buildJob).toMatch(/generateReleaseNotes:\s*false/);
		expect(yml).not.toMatch(/generateReleaseNotes:\s*true/);
	});
});
