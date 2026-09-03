import { describe, expect, it } from 'vitest';
import { measureGraph, staticClosure } from '../../scripts/bundle-graph.mjs';
import { randomBytes } from 'node:crypto';

const chunk = (fileName: string, imports: string[] = []) => ({
	fileName,
	imports,
	isEntry: false,
	moduleIds: []
});
describe('static bundle graph budget', () => {
	it('counts shared dependencies once, including cycles, and excludes dynamic-only files', () => {
		const chunks = {
			app: chunk('app', ['shared']),
			page: chunk('page', ['shared']),
			shared: chunk('shared', ['app']),
			lazy: chunk('lazy')
		};
		expect(staticClosure(chunks, ['app', 'page'])).toEqual(['app', 'page', 'shared']);
	});
	it('measures shared chunk growth even when entry filenames do not change', () => {
		const chunks = { app: chunk('app', ['shared']), shared: chunk('shared') };
		const before = measureGraph(chunks, ['app'], () => new Uint8Array([1]));
		const after = measureGraph(chunks, ['app'], (file) =>
			file === 'shared' ? randomBytes(4096) : new Uint8Array([1])
		);
		expect(after.gzip - before.gzip).toBeGreaterThan(4000);
	});
	it('fails closed on a missing static dependency', () => {
		expect(() => staticClosure({ app: chunk('app', ['missing']) }, ['app'])).toThrow('missing');
	});
});
