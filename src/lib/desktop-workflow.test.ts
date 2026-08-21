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
	const buildJob = jobBlock(yml, 'build-desktop');
	const publishJob = jobBlock(yml, 'publish-desktop-beta');

	it('keeps untrusted builds read-only on fixed runners', () => {
		expect(yml).toMatch(/permissions:\n {2}contents: read/);
		expect(buildJob).toContain('platform: windows-2022');
		expect(buildJob).toContain('platform: ubuntu-24.04');
		expect(buildJob).toContain('platform: macos-14');
		expect(buildJob).not.toContain('contents: write');
		expect(buildJob).not.toContain('GITHUB_TOKEN');
		expect(buildJob).toContain('persist-credentials: false');
	});

	it('publishes a distinct beta only after checksums, SBOMs, and attestation', () => {
		expect(publishJob).toContain('needs: [build-desktop, build-sbom]');
		expect(publishJob).toContain('contents: write');
		expect(publishJob).toContain('id-token: write');
		expect(publishJob).toContain('attestations: write');
		expect(publishJob).toContain('SHA256SUMS');
		expect(publishJob).toContain(
			'actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8'
		);
		expect(publishJob).toContain('DESKTOP_TAG: desktop-${{ env.RELEASE_TAG }}');
		expect(publishJob).toContain('--prerelease');
	});
});
