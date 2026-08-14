import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, it, expect, afterEach } from 'vitest';
import {
	formatGithubOutput,
	fetchReleaseId,
	resolveDesktopReleaseMeta
} from '../../scripts/desktop-release-meta.mjs';
import { readChangelogSection } from '../../scripts/changelog-section.mjs';

const temps: string[] = [];
afterEach(() => {
	for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('formatGithubOutput', () => {
	it('throws on empty notes (fail closed)', () => {
		expect(() => formatGithubOutput({ notes: '' })).toThrow(/empty changelog notes/);
		expect(() => formatGithubOutput({ notes: '   \n' })).toThrow(/empty changelog notes/);
	});

	it('writes multiline notes with a heredoc delimiter', () => {
		const out = formatGithubOutput({ notes: '## [1.3.0]\n\n* line one\n* line two\n' });
		expect(out).toContain('notes<<MDSH_NOTES_EOF');
		expect(out).toContain('## [1.3.0]');
		expect(out).toContain('* line two');
		expect(out).toContain('MDSH_NOTES_EOF');
		expect(out).not.toMatch(/^id=/m);
	});

	it('writes a numeric id and never emits an empty id= key', () => {
		expect(formatGithubOutput({ notes: 'ok', id: 370689393 })).toMatch(/^id=370689393$/m);
		expect(formatGithubOutput({ notes: 'ok', id: '42' })).toMatch(/^id=42$/m);
		for (const id of ['', 'abc', undefined, null]) {
			const out = formatGithubOutput({ notes: 'ok', id });
			expect(out).not.toMatch(/^id=/m);
			expect(out).not.toContain('id=');
		}
		expect(formatGithubOutput({ notes: 'ok' })).not.toContain('id=');
	});
});

describe('fetchReleaseId', () => {
	it('returns a numeric id on 200 and omits otherwise', async () => {
		const ok = await fetchReleaseId('v1.3.0', {
			repo: 'owner/repo',
			fetchImpl: async () =>
				new Response(JSON.stringify({ id: 99 }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
		});
		expect(ok).toBe(99);
		const missing = await fetchReleaseId('v1.3.0', {
			repo: 'owner/repo',
			fetchImpl: async () => new Response('nope', { status: 404 })
		});
		expect(missing).toBeUndefined();
	});
});

describe('resolveDesktopReleaseMeta', () => {
	const changelogPath = join(process.cwd(), 'CHANGELOG.md');

	it('reads live CHANGELOG notes for v1.3.0 and keeps a numeric id', async () => {
		const meta = await resolveDesktopReleaseMeta({
			tag: 'v1.3.0',
			changelogPath,
			repo: 'ThomasCrouzet/mdsh',
			fetchImpl: async () =>
				new Response(JSON.stringify({ id: 370689393 }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
		});
		expect(meta.notes).toBe(readChangelogSection('v1.3.0', changelogPath));
		expect(meta.notes).toContain('BLACKSITE');
		expect(meta.id).toBe(370689393);
	});

	it('omits id when the release lookup misses, and skips fetch without a repo', async () => {
		const missing = await resolveDesktopReleaseMeta({
			tag: 'v1.3.0',
			changelogPath,
			repo: 'ThomasCrouzet/mdsh',
			fetchImpl: async () => new Response('nope', { status: 404 })
		});
		expect(missing.notes).toContain('BLACKSITE');
		expect(missing).not.toHaveProperty('id');

		const noRepo = await resolveDesktopReleaseMeta({ tag: 'v1.3.0', changelogPath });
		expect(noRepo.notes).toContain('BLACKSITE');
		expect(noRepo).not.toHaveProperty('id');
	});

	it('throws when CHANGELOG has no section for the tag', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'mdsh-release-meta-'));
		temps.push(dir);
		const missingPath = join(dir, 'CHANGELOG.md');
		writeFileSync(missingPath, '## [1.0.0]\n\n* old\n');
		await expect(
			resolveDesktopReleaseMeta({ tag: 'v9.9.9', changelogPath: missingPath })
		).rejects.toThrow(/no CHANGELOG heading/);
	});
});

describe('scripts/desktop-release-meta.mjs CLI', () => {
	const scriptPath = join(process.cwd(), 'scripts/desktop-release-meta.mjs');

	it('appends notes to GITHUB_OUTPUT from the live CHANGELOG and omits id=', () => {
		const dir = mkdtempSync(join(tmpdir(), 'mdsh-release-meta-'));
		temps.push(dir);
		const outFile = join(dir, 'github-output');
		writeFileSync(outFile, '');
		execFileSync(process.execPath, [scriptPath], {
			encoding: 'utf8',
			cwd: process.cwd(),
			env: {
				...process.env,
				RELEASE_TAG: 'v1.3.0',
				GITHUB_OUTPUT: outFile,
				GITHUB_REPOSITORY: '',
				GITHUB_TOKEN: '',
				GH_TOKEN: ''
			}
		});
		const written = readFileSync(outFile, 'utf8');
		expect(written).toContain('notes<<MDSH_NOTES_EOF');
		expect(written).toContain('BLACKSITE');
		expect(written).toContain('nanoid');
		expect(written).not.toContain('id=');
	});

	it('exits 0 without writing outputs when RELEASE_TAG is empty', () => {
		const dir = mkdtempSync(join(tmpdir(), 'mdsh-release-meta-'));
		temps.push(dir);
		const outFile = join(dir, 'github-output');
		writeFileSync(outFile, '');
		execFileSync(process.execPath, [scriptPath], {
			encoding: 'utf8',
			cwd: process.cwd(),
			env: {
				...process.env,
				RELEASE_TAG: '',
				GITHUB_OUTPUT: outFile
			}
		});
		expect(readFileSync(outFile, 'utf8')).toBe('');
	});

	it('exits 2 when GITHUB_OUTPUT is missing', () => {
		try {
			execFileSync(process.execPath, [scriptPath], {
				encoding: 'utf8',
				cwd: process.cwd(),
				env: {
					...process.env,
					RELEASE_TAG: 'v1.3.0',
					GITHUB_OUTPUT: ''
				},
				stdio: ['ignore', 'pipe', 'pipe']
			});
			expect.unreachable('CLI should reject a missing GITHUB_OUTPUT');
		} catch (err) {
			expect(err).toMatchObject({ status: 2 });
		}
	});
});
