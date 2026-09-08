import { IMPORT_LIMITS } from './config';
import { t } from './i18n';
import { notify } from './notify.svelte';
import { reportError } from './report';

export interface FileLaunchQueue {
	setConsumer: (consumer: (params: { files: FileSystemFileHandle[] }) => Promise<void>) => void;
}

/** Register once after hydration. The normal importer enforces content and batch limits. */
export function registerFileLaunch(
	queue: FileLaunchQueue | undefined,
	importFiles: (files: File[]) => Promise<unknown>
): void {
	queue?.setConsumer(async ({ files }) => {
		const received: File[] = [];
		if (files.length > IMPORT_LIMITS.maxFiles) notify.error(t('import.fileCount'));
		for (const handle of files.slice(0, IMPORT_LIMITS.maxFiles)) {
			try {
				received.push(await handle.getFile());
			} catch (error) {
				reportError('launch queue', error, { notifyUser: t('fileIntents.openReceivedFailed') });
			}
		}
		if (received.length === 0) return;
		try {
			await importFiles(received);
		} catch (error) {
			reportError('launch import', error, { notifyUser: t('fileIntents.openReceivedFailed') });
		}
	});
}
