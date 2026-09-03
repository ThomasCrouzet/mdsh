import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { annotateCargoSbom } from '../../scripts/annotate-cargo-sbom.mjs';

const root = process.cwd();
const patchPath = resolve(root, 'patches/glib/variant-str-iter.patch');
const patch = readFileSync(patchPath);
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], {
	cwd: root,
	encoding: 'utf8'
}).trim();
const script = resolve(root, 'scripts/annotate-cargo-sbom.mjs');
const temporaryDirectories: string[] = [];

function component() {
	return {
		type: 'library',
		name: 'glib',
		version: '0.18.5',
		'bom-ref': 'path+file:///tmp/review/src-tauri/vendor/glib#0.18.5',
		purl: 'pkg:cargo/glib@0.18.5?download_url=file://vendor/glib',
		licenses: [{ expression: 'MIT' }],
		pedigree: { notes: 'Conserver la provenance existante.' },
		externalReferences: [{ type: 'vcs', url: 'https://github.com/gtk-rs/gtk-rs-core' }],
		properties: [{ name: 'existing', value: 'preserved' }]
	};
}

function fixture() {
	return {
		bomFormat: 'CycloneDX',
		specVersion: '1.5',
		version: 1,
		metadata: {
			timestamp: '2026-09-03T00:00:00Z',
			component: { type: 'application', name: 'mdsh' }
		},
		components: [
			component(),
			{ type: 'library', name: 'glib', version: '0.21.5', 'bom-ref': 'registry-glib-0.21.5' }
		],
		dependencies: [{ ref: 'mdsh', dependsOn: [component()['bom-ref']] }]
	};
}

function annotatedComponent(result: ReturnType<typeof annotateCargoSbom>) {
	return (result.components as Record<string, unknown>[])[0]!;
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true });
});

describe('Provenance CycloneDX du correctif glib', () => {
	it('conserve la vraie version, les identités, les autres composants et toutes les métadonnées', () => {
		const input = fixture();
		const original = structuredClone(input);
		const output = annotateCargoSbom(input, patch, sourceSha);
		const target = annotatedComponent(output);
		expect(input).toEqual(original);
		expect({ ...output, components: undefined }).toEqual({ ...original, components: undefined });
		expect((output.components as unknown[])[1]).toEqual(original.components[1]);
		expect(target).toMatchObject({
			type: 'library',
			name: 'glib',
			version: '0.18.5',
			'bom-ref': component()['bom-ref'],
			purl: component().purl,
			licenses: component().licenses,
			pedigree: component().pedigree
		});
		expect((target.externalReferences as unknown[])[0]).toEqual(component().externalReferences[0]);
		expect((target.properties as unknown[])[0]).toEqual(component().properties[0]);
		expect(target.version).toBe('0.18.5');
		const pedigree = target.pedigree as {
			patches: {
				type: string;
				diff: { url: string; text: { content: string } };
				resolves: { id: string; references: string[] }[];
			}[];
		};
		const backport = pedigree.patches[0]!;
		expect(backport.type).toBe('backport');
		expect(Buffer.from(backport.diff.text.content, 'base64')).toEqual(patch);
		expect(backport.diff.url).toContain(`/${sourceSha}/patches/glib/variant-str-iter.patch`);
		expect(backport.diff).not.toHaveProperty('hashes');
		expect(backport.resolves[0]).toMatchObject({ id: 'GHSA-wrw7-89jp-8q8g' });
		expect(backport.resolves[0]!.references).toContain(
			'https://github.com/gtk-rs/gtk-rs-core/commit/b5a4071e439bef2b5eea76c3aa25e5ae84839e34'
		);
		expect(target.externalReferences).toContainEqual(
			expect.objectContaining({
				url: backport.diff.url,
				hashes: [
					{
						alg: 'SHA-256',
						content: '982b07f58864aad3d0aa0421cdd8ddc7438bb862b93e7b6b34da96b4147f8add'
					}
				]
			})
		);
		expect(annotateCargoSbom(output, patch, sourceSha)).toEqual(output);
	});

	it('accepte le PURL encodé et retrouve les composants imbriqués', () => {
		const target = {
			...component(),
			purl: 'pkg:cargo/glib@0.18.5?download_url=file%3A%2F%2Fvendor%2Fglib'
		};
		const input = {
			...fixture(),
			components: [{ type: 'library', name: 'parent', components: [target] }]
		};
		const output = annotateCargoSbom(input, patch, sourceSha);
		expect(JSON.stringify(output)).toContain('backport');
		expect(JSON.stringify(output)).toContain(target.purl);
	});

	it('préserve un autre correctif et ses références existantes', () => {
		const input = fixture();
		const otherPatch = { type: 'backport', diff: { text: { content: 'correctif existant' } } };
		Object.assign(input.components[0]!, {
			pedigree: { ...component().pedigree, patches: [otherPatch] }
		});
		const target = annotatedComponent(annotateCargoSbom(input, patch, sourceSha));
		expect((target.pedigree as { patches: unknown[] }).patches).toHaveLength(2);
		expect((target.pedigree as { patches: unknown[] }).patches[0]).toEqual(otherPatch);
	});

	it.each(['absent', 'doublon', 'doublon metadata'])('refuse une cible %s', (kind) => {
		const input = fixture();
		if (kind === 'absent') input.components.shift();
		else if (kind === 'doublon') input.components.push(component());
		else Object.assign(input.metadata, { component: component() });
		expect(() => annotateCargoSbom(input, patch, sourceSha)).toThrow('unique composant');
	});

	it.each([
		{ purl: 'pkg:cargo/glib@0.18.5' },
		{ purl: 'pkg:cargo/glib@0.18.5?download_url=file://other/glib' },
		{ purl: 'pkg:cargo/glib@0.18.5?download_url=file://vendor/glib&vcs_url=unknown' },
		{ purl: 'pkg:cargo/glib@0.18.5?download_url=file://vendor/glib?extra' },
		{ purl: 'pkg:cargo/glib@0.19.9?download_url=file://vendor/glib' },
		{ 'bom-ref': 'registry+https://github.com/rust-lang/crates.io-index#glib@0.18.5' },
		{ type: 'application' },
		{ group: 'other' }
	])('refuse une identité incohérente %j', (change) => {
		const input = fixture();
		Object.assign(input.components[0]!, change);
		expect(() => annotateCargoSbom(input, patch, sourceSha)).toThrow('Identité locale');
	});

	it('refuse une référence partagée par deux composants', () => {
		const input = fixture();
		input.components[1]!['bom-ref'] = component()['bom-ref'];
		expect(() => annotateCargoSbom(input, patch, sourceSha)).toThrow('Identité locale');
	});

	it('refuse un patch altéré, un SHA ambigu, un format différent ou une signature invalidée', () => {
		expect(() => annotateCargoSbom(fixture(), Buffer.from('autre patch'), sourceSha)).toThrow(
			'SHA256'
		);
		expect(() => annotateCargoSbom(fixture(), patch, 'main')).toThrow('SOURCE_SHA');
		expect(() => annotateCargoSbom({ ...fixture(), specVersion: '1.6' }, patch, sourceSha)).toThrow(
			'1.5'
		);
		expect(() => annotateCargoSbom({ ...fixture(), signature: {} }, patch, sourceSha)).toThrow(
			'signé'
		);
	});

	it.each(['patch', 'référence', 'propriété', 'autre source'])(
		'refuse la provenance contradictoire : %s',
		(kind) => {
			const output = annotateCargoSbom(fixture(), patch, sourceSha);
			const target = annotatedComponent(output);
			if (kind === 'patch')
				(target.pedigree as { patches: { type: string }[] }).patches[0]!.type = 'unofficial';
			if (kind === 'référence')
				(target.externalReferences as { hashes?: unknown[] }[])[1]!.hashes = [];
			if (kind === 'propriété') (target.properties as { value: string }[])[1]!.value = 'incorrect';
			expect(() =>
				annotateCargoSbom(output, patch, kind === 'autre source' ? '0'.repeat(40) : sourceSha)
			).toThrow(/contradictoire/);
		}
	);

	it('refuse les listes malformées au lieu de perdre des métadonnées', () => {
		const input = fixture();
		Object.assign(input.components[0]!, { pedigree: { patches: {} } });
		expect(() => annotateCargoSbom(input, patch, sourceSha)).toThrow('Liste CycloneDX');
	});

	it('CLI : vérifie le commit suivi, écrit en place et laisse le fichier intact après un refus', () => {
		const directory = mkdtempSync(join(tmpdir(), 'mdsh-sbom-test-'));
		temporaryDirectories.push(directory);
		const sbomPath = join(directory, 'sbom.json');
		writeFileSync(sbomPath, JSON.stringify(fixture()));
		const run = (sha: string, localPatch = patchPath) =>
			spawnSync(process.execPath, [script, sbomPath, localPatch], {
				env: { ...process.env, SOURCE_SHA: sha },
				encoding: 'utf8'
			});
		expect(run(sourceSha).status).toBe(0);
		const annotated = readFileSync(sbomPath, 'utf8');
		expect(JSON.parse(annotated)).toEqual(annotateCargoSbom(fixture(), patch, sourceSha));
		expect(run(sourceSha).status).toBe(0);
		expect(readFileSync(sbomPath, 'utf8')).toBe(annotated);
		expect(run('f'.repeat(40)).stderr).toContain('HEAD');
		expect(readFileSync(sbomPath, 'utf8')).toBe(annotated);
		const wrongPatch = join(directory, 'wrong.patch');
		writeFileSync(wrongPatch, 'altéré');
		expect(run(sourceSha, wrongPatch).stderr).toContain('diffère');
		expect(readFileSync(sbomPath, 'utf8')).toBe(annotated);
	});
});
