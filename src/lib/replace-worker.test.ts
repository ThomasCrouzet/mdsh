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

describe('replacement in an isolated worker', () => {
	it.each(['(a+){10}$', '^(a{1,3})+$'])(
		'stops a worker blocked by %s without a partial result',
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

	it('uses a new worker after timeout and releases the successful worker', async () => {
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

	it('reports a load error without changing the corpus', async () => {
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

	it('keeps literal replacement without a user regular expression engine', async () => {
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
