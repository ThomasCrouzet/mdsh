import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

describe('desktop.yml release notes policy', () => {
	const yml = readFileSync(resolve(process.cwd(), '.github/workflows/desktop.yml'), 'utf8');

	it('does not let tauri-action overwrite the release-please changelog body', () => {
		expect(yml).toMatch(/generateReleaseNotes:\s*false/);
		expect(yml).not.toMatch(/generateReleaseNotes:\s*true/);
	});
});
