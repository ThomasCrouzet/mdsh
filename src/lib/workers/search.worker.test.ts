import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchRequest, SearchResponse } from './search.worker';

const worker = vi.hoisted(() => ({
	listener: null as ((event: MessageEvent<SearchRequest>) => void) | null,
	responses: [] as SearchResponse[]
}));

beforeEach(async () => {
	worker.listener = null;
	worker.responses = [];
	vi.resetModules();
	vi.stubGlobal('self', {
		addEventListener: (_name: string, listener: (event: MessageEvent<SearchRequest>) => void) => {
			worker.listener = listener;
		},
		postMessage: (response: SearchResponse) => worker.responses.push(response)
	});
	await import('./search.worker');
});

describe('search worker bridge', () => {
	it('reuses the last corpus and preserves request identifiers', () => {
		worker.listener?.({
			data: {
				id: 1,
				files: [{ id: 'a', name: 'a.md', content: 'alpha beta' }],
				query: 'alpha',
				caseSensitive: false,
				wholeWord: false,
				useRegex: false
			}
		} as MessageEvent<SearchRequest>);
		worker.listener?.({
			data: {
				id: 2,
				query: 'beta',
				caseSensitive: false,
				wholeWord: true,
				useRegex: false
			}
		} as MessageEvent<SearchRequest>);

		expect(worker.responses.map((response) => response.id)).toEqual([1, 2]);
		expect(worker.responses[0]?.hits).toHaveLength(1);
		expect(worker.responses[1]?.hits).toHaveLength(1);
	});

	it('returns invalid regular expressions without throwing from the event bridge', () => {
		worker.listener?.({
			data: {
				id: 3,
				files: [{ id: 'a', name: 'a.md', content: 'alpha' }],
				query: '[a',
				caseSensitive: false,
				wholeWord: false,
				useRegex: true
			}
		} as MessageEvent<SearchRequest>);

		expect(worker.responses[0]).toMatchObject({ id: 3, hits: [] });
		expect(worker.responses[0]?.regexError).toBeTypeOf('string');
	});
});
