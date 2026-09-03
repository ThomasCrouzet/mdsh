import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '$lib/i18n';
import { replaceInFilesAsync, REGEX_EXECUTION_TIMEOUT_MS } from './replace-worker';

class FakeWorker extends EventTarget {
	postMessage = vi.fn();
	terminate = vi.fn();
}

const files = [{ id: 'a', name: 'a.md', content: `${'a'.repeat(60)}!` }];
const opts = { caseSensitive: true, wholeWord: false, useRegex: true };

afterEach(() => vi.useRealTimers());

describe('remplacement isolé dans un worker', () => {
	it.each(['(a+){10}$', '^(a{1,3})+$'])(
		'termine le worker bloqué par %s sans résultat partiel',
		async (query) => {
			vi.useFakeTimers();
			const worker = new FakeWorker();
			const result = replaceInFilesAsync(files, query, 'x', opts, { createWorker: () => worker });
			expect(worker.postMessage).toHaveBeenCalledWith({ files, query, replacement: 'x', opts });
			await vi.advanceTimersByTimeAsync(REGEX_EXECUTION_TIMEOUT_MS);
			await expect(result).resolves.toEqual({
				results: [],
				total: 0,
				regexError: t('search.timeout')
			});
			expect(worker.terminate).toHaveBeenCalledOnce();
		}
	);

	it('utilise un nouveau worker après expiration et libère celui qui a réussi', async () => {
		vi.useFakeTimers();
		const stuck = new FakeWorker();
		const first = replaceInFilesAsync(files, '(a+){10}$', 'x', opts, { createWorker: () => stuck });
		await vi.advanceTimersByTimeAsync(REGEX_EXECUTION_TIMEOUT_MS);
		await first;
		const next = new FakeWorker();
		const second = replaceInFilesAsync(files, 'a+', 'x', opts, { createWorker: () => next });
		const outcome = {
			results: [{ id: 'a', name: 'a.md', content: 'x!', count: 1 }],
			total: 1,
			regexError: null
		};
		next.dispatchEvent(new MessageEvent('message', { data: outcome }));
		await expect(second).resolves.toEqual(outcome);
		expect(next.terminate).toHaveBeenCalledOnce();
	});

	it('rapporte une erreur de chargement sans modifier le corpus', async () => {
		const worker = new FakeWorker();
		const result = replaceInFilesAsync(files, 'a+', 'x', opts, { createWorker: () => worker });
		worker.dispatchEvent(new Event('error'));
		await expect(result).resolves.toEqual({
			results: [],
			total: 0,
			regexError: t('search.unavailable')
		});
		expect(files[0]?.content).toBe(`${'a'.repeat(60)}!`);
	});

	it('garde le remplacement littéral sans moteur regex utilisateur', async () => {
		const createWorker = vi.fn();
		const result = await replaceInFilesAsync(
			[{ id: 'a', name: 'a.md', content: 'foo foo' }],
			'foo',
			'bar',
			{ ...opts, useRegex: false },
			{ createWorker }
		);
		expect(result.total).toBe(2);
		expect(result.results[0]?.content).toBe('bar bar');
		expect(createWorker).not.toHaveBeenCalled();
	});
});
