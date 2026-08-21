import { spawnSync } from 'node:child_process';

function run(command, args, required) {
	const result = spawnSync(command, args, {
		stdio: 'inherit',
		shell: process.platform === 'win32'
	});
	if (result.status === 0) return;
	if (required) process.exit(result.status ?? 1);
	console.warn(
		'Git hooks were not installed. Run npx lefthook install after cloning the repository.'
	);
}

run('npx', ['svelte-kit', 'sync'], true);
run('npx', ['lefthook', 'install'], false);
