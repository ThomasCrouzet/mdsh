import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	runPaletteCopyActive,
	runPaletteDirectoryImport,
	runPaletteSaveTemplate,
	runPaletteSaveWorkspace
} from './palette-ops';
import { t } from '$lib/i18n';

describe('runPaletteDirectoryImport', () => {
	const showSpinner = vi.fn(() => vi.fn());
	const notifySuccess = vi.fn();
	const reportError = vi.fn();

	beforeEach(() => {
		showSpinner.mockClear().mockReturnValue(vi.fn());
		notifySuccess.mockClear();
		reportError.mockClear();
	});

	it('toasts a truncated import and always dismisses the spinner', async () => {
		const dismiss = vi.fn();
		showSpinner.mockReturnValue(dismiss);
		await runPaletteDirectoryImport({
			importDirectory: async () => ({ count: 3, truncated: true }),
			showSpinner,
			notifySuccess,
			reportError,
			t
		});
		expect(notifySuccess).toHaveBeenCalledOnce();
		expect(String(notifySuccess.mock.calls[0]![0])).toMatch(/3/);
		expect(dismiss).toHaveBeenCalledOnce();
	});

	it('stays silent when zero files were imported', async () => {
		await runPaletteDirectoryImport({
			importDirectory: async () => ({ count: 0, truncated: false }),
			showSpinner,
			notifySuccess,
			reportError,
			t
		});
		expect(notifySuccess).not.toHaveBeenCalled();
	});

	it('reports and rethrows a failed import after dismissing', async () => {
		const dismiss = vi.fn();
		showSpinner.mockReturnValue(dismiss);
		const err = new Error('picker');
		await expect(
			runPaletteDirectoryImport({
				importDirectory: async () => {
					throw err;
				},
				showSpinner,
				notifySuccess,
				reportError,
				t
			})
		).rejects.toThrow('picker');
		expect(reportError).toHaveBeenCalledWith('directory import', err, expect.any(Object));
		expect(dismiss).toHaveBeenCalledOnce();
	});
});

describe('runPaletteCopyActive', () => {
	const copyMarkdown = vi.fn(async () => {});
	const copyRichHtml = vi.fn(async () => {});
	const notifySuccess = vi.fn();
	const notifyError = vi.fn();
	const reportError = vi.fn();

	beforeEach(() => {
		copyMarkdown.mockClear();
		copyRichHtml.mockClear();
		notifySuccess.mockClear();
		notifyError.mockClear();
		reportError.mockClear();
	});

	it('returns false when no file is active', async () => {
		const ok = await runPaletteCopyActive('md', {
			getActive: () => null,
			isClipboardSupported: () => true,
			copyMarkdown,
			copyRichHtml,
			notifySuccess,
			notifyError,
			reportError,
			t
		});
		expect(ok).toBe(false);
		expect(copyMarkdown).not.toHaveBeenCalled();
	});

	it('toasts when the clipboard API is missing', async () => {
		const ok = await runPaletteCopyActive('md', {
			getActive: () => ({ content: '# x' }),
			isClipboardSupported: () => false,
			copyMarkdown,
			copyRichHtml,
			notifySuccess,
			notifyError,
			reportError,
			t
		});
		expect(ok).toBe(false);
		expect(notifyError).toHaveBeenCalledOnce();
	});

	it('copies markdown and toasts success', async () => {
		const ok = await runPaletteCopyActive('md', {
			getActive: () => ({ content: '# x' }),
			isClipboardSupported: () => true,
			copyMarkdown,
			copyRichHtml,
			notifySuccess,
			notifyError,
			reportError,
			t
		});
		expect(ok).toBe(true);
		expect(copyMarkdown).toHaveBeenCalledWith('# x');
		expect(copyRichHtml).not.toHaveBeenCalled();
		expect(notifySuccess).toHaveBeenCalledOnce();
	});

	it('copies rich HTML and reports a copy failure', async () => {
		const err = new Error('denied');
		copyRichHtml.mockRejectedValueOnce(err);
		const ok = await runPaletteCopyActive('html', {
			getActive: () => ({ content: '# x' }),
			isClipboardSupported: () => true,
			copyMarkdown,
			copyRichHtml,
			notifySuccess,
			notifyError,
			reportError,
			t
		});
		expect(ok).toBe(false);
		expect(reportError).toHaveBeenCalledWith('clipboard copy', err, expect.any(Object));
	});
});

describe('runPaletteSaveWorkspace', () => {
	it('aborts when the prompt is cancelled', async () => {
		const save = vi.fn();
		const notifySuccess = vi.fn();
		const ok = await runPaletteSaveWorkspace({
			promptName: async () => null,
			save,
			notifySuccess,
			t
		});
		expect(ok).toBe(false);
		expect(save).not.toHaveBeenCalled();
	});

	it('saves and toasts on success', async () => {
		const save = vi.fn(async () => ({ id: 'ws' }));
		const notifySuccess = vi.fn();
		const ok = await runPaletteSaveWorkspace({
			promptName: async () => 'Session',
			save,
			notifySuccess,
			t
		});
		expect(ok).toBe(true);
		expect(save).toHaveBeenCalledWith('Session');
		expect(notifySuccess).toHaveBeenCalledOnce();
	});

	it('does not toast when save returns a falsy value', async () => {
		const notifySuccess = vi.fn();
		const ok = await runPaletteSaveWorkspace({
			promptName: async () => 'Session',
			save: async () => null,
			notifySuccess,
			t
		});
		expect(ok).toBe(false);
		expect(notifySuccess).not.toHaveBeenCalled();
	});
});

describe('runPaletteSaveTemplate', () => {
	it('returns false without an active file', async () => {
		const promptName = vi.fn();
		const ok = await runPaletteSaveTemplate({
			getActive: () => null,
			promptName,
			save: vi.fn(),
			notifySuccess: vi.fn(),
			stripExt: (n) => n.replace(/\.md$/, ''),
			t
		});
		expect(ok).toBe(false);
		expect(promptName).not.toHaveBeenCalled();
	});

	it('prompts with the stripped name and saves content', async () => {
		const save = vi.fn(async () => ({ id: 'tpl' }));
		const notifySuccess = vi.fn();
		const ok = await runPaletteSaveTemplate({
			getActive: () => ({ name: 'Note.md', content: 'body' }),
			promptName: async (def) => {
				expect(def).toBe('Note');
				return 'My template';
			},
			save,
			notifySuccess,
			stripExt: (n) => n.replace(/\.md$/i, ''),
			t
		});
		expect(ok).toBe(true);
		expect(save).toHaveBeenCalledWith('My template', 'body');
		expect(notifySuccess).toHaveBeenCalledOnce();
	});
});
