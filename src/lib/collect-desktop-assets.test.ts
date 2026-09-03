import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { collectDesktopAssets } from '../../scripts/collect-desktop-assets.mjs';

const folders: string[] = [];
afterEach(() => {
	for (const folder of folders.splice(0)) rmSync(folder, { recursive: true });
});
const identity = { sha: 'a'.repeat(40), tag: 'v1.5.0' };
function setup() {
	const root = mkdtempSync(join(tmpdir(), 'mdsh-assets-'));
	folders.push(root);
	const input = join(root, 'input');
	const output = join(root, 'output');
	mkdirSync(input);
	for (const name of [
		'mdsh_aarch64.dmg',
		'mdsh_x64.dmg',
		'mdsh.AppImage',
		'mdsh.deb',
		'mdsh.rpm',
		'mdsh.msi',
		'mdsh-setup.exe',
		'sbom-npm.cdx.json',
		'sbom-cargo.cdx.json'
	])
		writeFileSync(join(input, name), name);
	writeFileSync(
		join(input, 'desktop-source.json'),
		JSON.stringify({ ...identity, version: '1.5.0' })
	);
	return { input, output };
}
describe('release asset collection', () => {
	it('flattens only installers and produces independently verifiable checksums', () => {
		const { input, output } = setup();
		mkdirSync(join(input, 'mdsh.app'));
		writeFileSync(join(input, 'mdsh.app', 'internal.exe'), 'internal');
		writeFileSync(join(input, 'build.log'), 'log');
		const files = collectDesktopAssets(input, output, identity);
		expect(files).toHaveLength(10);
		expect(files).not.toContain('internal.exe');
		for (const line of readFileSync(join(output, 'SHA256SUMS'), 'utf8').trim().split('\n')) {
			const [hash, name] = line.split('  ');
			expect(hash).toBe(
				createHash('sha256')
					.update(readFileSync(join(output, name!)))
					.digest('hex')
			);
		}
	});
	it('rejects filename collisions before copying', () => {
		const { input, output } = setup();
		mkdirSync(join(input, 'another'));
		writeFileSync(join(input, 'another', 'mdsh_x64.dmg'), 'other architecture');
		expect(() => collectDesktopAssets(input, output, identity)).toThrow('Collision');
	});
	it('rejects mismatched source identity and an incomplete installer matrix', () => {
		const { input, output } = setup();
		expect(() => collectDesktopAssets(input, output, { ...identity, sha: 'b'.repeat(40) })).toThrow(
			'source annoncée'
		);
		rmSync(join(input, 'mdsh.msi'));
		expect(() => collectDesktopAssets(input, output, identity)).toThrow('requis absent');
	});
});
