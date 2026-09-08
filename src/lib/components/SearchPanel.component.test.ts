import { render, screen, waitFor, cleanup } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import SearchPanel from './SearchPanel.svelte';
import { filesStore } from '$lib/files.svelte';
import { promptStore } from '$lib/prompt.svelte';
import { notify } from '$lib/notify.svelte';
import { t } from '$lib/i18n';

vi.mock('$lib/replace-worker', () => ({
	replaceInFilesAsync: vi.fn(async () => ({
		results: [{ id: 'a', name: 'a.md', content: 'after', count: 1 }],
		total: 1,
		regexError: null
	}))
}));

beforeEach(() => {
	filesStore.files = [
		{ id: 'a', name: 'a.md', content: 'before', createdAt: 1, updatedAt: 1, dirty: false }
	];
	vi.stubGlobal(
		'Worker',
		class {
			addEventListener() {}
			postMessage() {}
			terminate() {}
		}
	);
	vi.spyOn(promptStore, 'confirm').mockResolvedValue(true);
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

async function replace() {
	const user = userEvent.setup();
	await user.type(screen.getByRole('combobox'), 'before');
	await user.click(screen.getByTitle(t('search.replaceInFiles')));
	const button = screen.getByRole('button', { name: t('search.replaceAll') });
	await waitFor(() => expect(button).toBeEnabled());
	await user.click(button);
}

describe('replacement failure handling', () => {
	it('keeps the panel open when the store refuses a stale replacement', async () => {
		vi.spyOn(filesStore, 'replaceInAll').mockResolvedValue({
			files: 0,
			occurrences: 0,
			regexError: 'Changed in another tab'
		});
		const success = vi.spyOn(notify, 'success');
		const onClose = vi.fn();
		render(SearchPanel, { open: true, onClose });
		await replace();
		await waitFor(() =>
			expect(screen.getByRole('alert')).toHaveTextContent('Changed in another tab')
		);
		expect(onClose).not.toHaveBeenCalled();
		expect(success).not.toHaveBeenCalled();
	});

	it('reports a checkpoint failure and lets the user retry', async () => {
		vi.spyOn(filesStore, 'replaceInAll').mockRejectedValue(
			new DOMException('Full', 'QuotaExceededError')
		);
		const success = vi.spyOn(notify, 'success');
		const onClose = vi.fn();
		render(SearchPanel, { open: true, onClose });
		await replace();
		await waitFor(() =>
			expect(screen.getByRole('alert')).toHaveTextContent(t('search.replaceFailed'))
		);
		expect(screen.getByRole('button', { name: t('search.replaceAll') })).toBeEnabled();
		expect(onClose).not.toHaveBeenCalled();
		expect(success).not.toHaveBeenCalled();
	});

	it('does not label a worker timeout as a syntax error', async () => {
		render(SearchPanel, { open: true, onClose: vi.fn() });
		await userEvent.setup().type(screen.getByRole('combobox'), 'before');
		await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(t('search.timeout')), {
			timeout: 2000
		});
		expect(screen.getByRole('alert')).not.toHaveTextContent('Regex invalide');
		expect(screen.queryByText(t('search.resultCount', { n: 0 }))).not.toBeInTheDocument();
		expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
	});
});
