import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

describe('desktop.yml release notes policy', () => {
	const yml = readFileSync(resolve(process.cwd(), '.github/workflows/desktop.yml'), 'utf8');

	it('feeds CHANGELOG notes and an existing release id into tauri-action', () => {
		expect(yml).toContain('scripts/changelog-section.mjs');
		expect(yml).toMatch(/releaseBody:\s*\$\{\{\s*steps\.gh_release\.outputs\.notes\s*\}\}/);
		expect(yml).toMatch(/releaseId:\s*\$\{\{\s*steps\.gh_release\.outputs\.id\s*\}\}/);
		expect(yml).toMatch(/generateReleaseNotes:\s*false/);
		expect(yml).not.toMatch(/generateReleaseNotes:\s*true/);
	});
});
