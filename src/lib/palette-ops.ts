// Palette I/O flows extracted from CommandPalette so they can be unit-tested
// without mounting the Svelte component. The palette stays a command router.

import type { MessageKey } from './i18n';

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export interface ReportErrorFn {
	(scope: string, err: unknown, opts?: { notifyUser?: string }): void;
}

export async function runPaletteDirectoryImport(deps: {
	importDirectory: () => Promise<{ count: number; truncated: boolean }>;
	showSpinner: (label: string) => () => void;
	notifySuccess: (message: string) => void;
	reportError: ReportErrorFn;
	t: Translate;
}): Promise<{ count: number; truncated: boolean }> {
	const dismiss = deps.showSpinner(deps.t('palette.importingDirectory'));
	try {
		const result = await deps.importDirectory();
		if (result.count === 0) return result;
		deps.notifySuccess(
			result.truncated
				? deps.t('palette.importedFilesTruncated', { n: result.count })
				: deps.t('palette.importedFiles', { n: result.count })
		);
		return result;
	} catch (err) {
		deps.reportError('directory import', err, {
			notifyUser: deps.t('palette.importDirectoryFailed')
		});
		throw err;
	} finally {
		dismiss();
	}
}

export async function runPaletteCopyActive(
	format: 'md' | 'html',
	deps: {
		getActive: () => { content: string } | null;
		isClipboardSupported: () => boolean;
		copyMarkdown: (content: string) => Promise<void>;
		copyRichHtml: (content: string) => Promise<void>;
		notifySuccess: (message: string) => void;
		notifyError: (message: string) => void;
		reportError: ReportErrorFn;
		t: Translate;
	}
): Promise<boolean> {
	const file = deps.getActive();
	if (!file) return false;
	if (!deps.isClipboardSupported()) {
		deps.notifyError(deps.t('palette.clipboardUnavailable'));
		return false;
	}
	try {
		if (format === 'md') {
			await deps.copyMarkdown(file.content);
			deps.notifySuccess(deps.t('palette.markdownCopied'));
		} else {
			await deps.copyRichHtml(file.content);
			deps.notifySuccess(deps.t('palette.htmlCopied'));
		}
		return true;
	} catch (err) {
		deps.reportError('clipboard copy', err, { notifyUser: deps.t('palette.copyFailed') });
		return false;
	}
}

export async function runPaletteSaveWorkspace(deps: {
	promptName: () => Promise<string | null>;
	save: (name: string) => Promise<unknown>;
	notifySuccess: (message: string) => void;
	t: Translate;
}): Promise<boolean> {
	const name = await deps.promptName();
	if (name === null) return false;
	if (await deps.save(name)) {
		deps.notifySuccess(deps.t('palette.workspaceSaved'));
		return true;
	}
	return false;
}

export async function runPaletteSaveTemplate(deps: {
	getActive: () => { name: string; content: string } | null;
	promptName: (defaultValue: string) => Promise<string | null>;
	save: (name: string, content: string) => Promise<unknown>;
	notifySuccess: (message: string) => void;
	stripExt: (name: string) => string;
	t: Translate;
}): Promise<boolean> {
	const file = deps.getActive();
	if (!file) return false;
	const name = await deps.promptName(deps.stripExt(file.name));
	if (name === null) return false;
	if (await deps.save(name, file.content)) {
		deps.notifySuccess(deps.t('palette.templateSaved'));
		return true;
	}
	return false;
}
