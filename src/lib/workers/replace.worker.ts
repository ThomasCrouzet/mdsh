import { replaceInFiles } from '$lib/replace';
import type { ReplaceWorkerRequest } from '$lib/replace-worker';

self.addEventListener('message', (event: MessageEvent<ReplaceWorkerRequest>) => {
	const { files, query, replacement, opts } = event.data;
	(self as unknown as Worker).postMessage(replaceInFiles(files, query, replacement, opts));
});
