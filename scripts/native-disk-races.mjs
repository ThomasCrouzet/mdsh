import assert from 'node:assert/strict';
import {
	existsSync,
	readFileSync,
	writeFileSync,
	renameSync,
	rmSync,
	mkdirSync,
	symlinkSync
} from 'node:fs';
import { join, basename } from 'node:path';

/** Exercise real native commands while a second process changes the selected file. */
export async function nativeDiskRaces({
	execute,
	executeAsync,
	until,
	fixture,
	gate,
	output,
	deliverFixture
}) {
	const original = readFileSync(fixture, 'utf8');
	const local = '# Native pending revision';
	const external = '# External replacement revision';
	const evidence = [];
	const invoke = (command, args) =>
		executeAsync(
			`const done = arguments[arguments.length - 1];
		window.__TAURI__.core.invoke(arguments[0], arguments[1]).then(value => done({ value }), error => done({ rejection: String(error) }));`,
			[command, args]
		);
	const grants = await invoke('disk_restore_grants', {});
	const grant = grants.value.find((item) => basename(item.path) === basename(fixture));
	assert.ok(grant, 'Race fixture needs a real native grant');
	const start = async (stage, command, args) => {
		rmSync(gate, { recursive: true, force: true });
		mkdirSync(gate, { recursive: true });
		writeFileSync(join(gate, 'armed.json'), JSON.stringify({ path: grant.path, stage }));
		await execute(
			`window.__diskRace = null; window.__TAURI__.core.invoke(arguments[0], arguments[1])
			.then(value => window.__diskRace = { value }, error => window.__diskRace = { rejection: String(error) });`,
			[command, args]
		);
		await until(() => existsSync(join(gate, 'reached')), `native disk gate ${stage}`, 10_000);
	};
	const finish = async (scenario) => {
		writeFileSync(join(gate, 'release'), 'release');
		const result = await until(() => execute('return window.__diskRace'), scenario);
		assert.equal(typeof result.rejection, 'string', JSON.stringify(result));
		evidence.push({ scenario, result, disk: readFileSync(fixture, 'utf8'), local });
	};
	const args = {
		token: grant.token,
		content: local,
		expectedRevision: grant.stat.revision,
		force: false
	};
	try {
		await start('staged', 'disk_write', args);
		const replacement = join(gate, 'replacement.md');
		writeFileSync(replacement, external);
		renameSync(replacement, fixture);
		await finish('concurrent replacement rejects the stale save');
		assert.equal(readFileSync(fixture, 'utf8'), external);
		writeFileSync(fixture, original);

		await start('staged', 'disk_write', args);
		const moved = `${fixture}.moved.md`;
		renameSync(fixture, moved);
		writeFileSync(fixture, external);
		await finish('concurrent rename retains both external entries');
		assert.equal(readFileSync(moved, 'utf8'), original);
		assert.equal(readFileSync(fixture, 'utf8'), external);
		rmSync(fixture);
		renameSync(moved, fixture);

		await start('rename', 'disk_rename', {
			token: grant.token,
			name: 'race-renamed.md',
			expectedRevision: grant.stat.revision
		});
		writeFileSync(fixture, external);
		await finish('rename rejects a changed source before changing its entry');
		assert.equal(existsSync(join(gate, '..', 'race-renamed.md')), false);
		writeFileSync(fixture, original);

		if (process.platform !== 'win32') {
			const target = join(gate, 'unapproved.md');
			writeFileSync(target, external);
			await start('staged', 'disk_write', { ...args, force: true });
			// Recreate the target after start resets the gate directory.
			writeFileSync(target, external);
			rmSync(fixture);
			symlinkSync(target, fixture);
			await finish('forced save rejects symlink substitution');
			assert.equal(readFileSync(target, 'utf8'), external);
			rmSync(fixture);
			writeFileSync(fixture, original);
		}

		await start('before-write', 'disk_write', args);
		assert.equal((await invoke('disk_forget_grant', { token: grant.token })).rejection, undefined);
		await finish('revocation before write rejects the expired token');
		assert.equal(readFileSync(fixture, 'utf8'), original);
	} finally {
		rmSync(gate, { recursive: true, force: true });
		writeFileSync(
			join(output, 'disk-races.json'),
			JSON.stringify({ original, local, external, evidence }, null, 2)
		);
	}
	await deliverFixture();
	return evidence;
}
