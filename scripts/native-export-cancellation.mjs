import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'node:fs';

/** Cancel real AppKit panels and check the editor after each completion callback. */
export async function nativeExportCancellation({
	execute,
	executeAsync,
	click,
	drafts,
	until,
	panelMarker
}) {
	const snapshot = async () => {
		const view = await execute(`return {
		id: document.querySelector('aside button[data-file-id][aria-current="true"]')?.getAttribute('data-file-id'),
		name: document.querySelector('header input')?.value,
		dirty: document.querySelector('aside button[data-file-id][aria-current="true"]')?.getAttribute('aria-label'),
		content: document.querySelector('.cm-content')?.textContent
	};`);
		const draft = (await drafts()).find((row) => row.id === view.id);
		assert.ok(draft, 'The active export draft must exist in IndexedDB');
		return { ...view, durableContent: draft.content };
	};
	const evidence = [];
	await click('button[data-mode="source"]');
	await until(
		() => execute('return !!document.querySelector(".cm-content")'),
		'source before export cancellation'
	);
	const before = await snapshot();
	for (const command of ['export-md', 'export-all', 'export-html', 'export-pdf']) {
		writeFileSync(panelMarker, 'show native panel');
		try {
			await click('button[aria-label="Palette de commandes"]');
			await click(`#cmd-palette-opt-${command}`);
			await until(
				async () => {
					const result = await executeAsync(`const done = arguments[arguments.length - 1];
					window.__TAURI__.core.invoke('desktop_smoke_cancel_dialog').then(done, error => done({ error: String(error) }));`);
					assert.equal(typeof result, 'boolean', JSON.stringify(result));
					return result;
				},
				`cancel native panel: ${command}`,
				30_000
			);
			await until(
				() =>
					execute(`return !document.querySelector('.spinner') && !document.getElementById('mdsh-native-print')
				&& !document.documentElement.hasAttribute('data-mdsh-printing');`),
				'export cancellation cleanup',
				5000
			);
			const after = await snapshot();
			assert.deepEqual(after, before);
			evidence.push({ command, before, after, nativePanelCancelled: true });
		} finally {
			rmSync(panelMarker, { force: true });
		}
	}
	return evidence;
}
