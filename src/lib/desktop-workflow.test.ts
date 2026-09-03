import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

function jobBlock(yml: string, name: string): string {
	const start = yml.search(new RegExp(`^  ${name}:\\s*$`, 'm'));
	if (start < 0) throw new Error(`job ${name} missing from desktop.yml`);
	const fromName = yml.slice(start);
	const next = fromName.slice(2).search(/\n {2}[A-Za-z][\w-]*:/);
	return next < 0 ? fromName : fromName.slice(0, next + 2);
}

describe('desktop release supply-chain contract', () => {
	const yml = readFileSync(resolve(process.cwd(), '.github/workflows/desktop.yml'), 'utf8');
	const resolveJob = jobBlock(yml, 'resolve-source');
	const buildJob = jobBlock(yml, 'build-desktop');
	const publishJob = jobBlock(yml, 'publish-desktop-beta');

	it('keeps untrusted builds read-only on fixed runners', () => {
		expect(yml).toMatch(/permissions:\n {2}contents: read/);
		expect(buildJob).toContain('platform: windows-2022');
		expect(buildJob).toContain('platform: ubuntu-24.04');
		expect(buildJob).toContain('platform: macos-15-intel');
		expect(buildJob).not.toContain('contents: write');
		expect(buildJob).not.toContain('GITHUB_TOKEN');
		expect(buildJob).toContain('persist-credentials: false');
	});

	it('requires an actual release tag that resolves to the checked out commit', () => {
		expect(yml).not.toContain("tags: ['v*']");
		expect(resolveJob).toContain("['show-ref', '--verify', '--quiet', `refs/tags/${tag}`]");
		expect(resolveJob).toContain('`${tag}^{commit}`');
		expect(resolveJob).toContain('if (tagSha !== sha)');
		expect(resolveJob).toContain('if (process.env.GITHUB_SHA !== sha)');
	});

	it('includes platform-specific Cargo dependencies in the shared SBOM', () => {
		expect(jobBlock(yml, 'build-sbom')).toContain('--target all');
	});

	it('publishes a distinct beta only after checksums, SBOMs, and attestation', () => {
		expect(publishJob).toContain('needs: [resolve-source, build-desktop, build-sbom]');
		expect(publishJob).toContain('contents: write');
		expect(publishJob).toContain('id-token: write');
		expect(publishJob).toContain('attestations: write');
		expect(publishJob).toContain('SHA256SUMS');
		expect(publishJob).toContain(
			'actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8'
		);
		expect(publishJob).toContain('DESKTOP_TAG: desktop-${{ env.RELEASE_TAG }}');
		expect(publishJob).toContain('git/ref/tags/$DESKTOP_TAG');
		expect(publishJob).toContain('release_target_sha');
		expect(publishJob).toContain('Artefacts inattendus dans la release existante');
		expect(publishJob).toContain('--prerelease');
	});
});
