import { describe, it, expect } from 'vitest';
import { buildGraph, computeLayout } from './graph';

const files = [
	{ id: 'a', label: 'Alpha' },
	{ id: 'b', label: 'Beta' },
	{ id: 'c', label: 'Gamma' }
];

describe('buildGraph', () => {
	it('creates one node per file', () => {
		const g = buildGraph(
			files,
			() => [],
			() => null
		);
		expect(g.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
		expect(g.edges).toEqual([]);
	});

	it('converts wiki links to edges', () => {
		const targets: Record<string, string[]> = { a: ['Beta'], b: ['Gamma'], c: [] };
		const resolve = (t: string) => ({ Alpha: 'a', Beta: 'b', Gamma: 'c' })[t] ?? null;
		const g = buildGraph(files, (id) => targets[id] ?? [], resolve);
		expect(g.edges).toEqual([
			{ source: 'a', target: 'b' },
			{ source: 'b', target: 'c' }
		]);
	});

	it('ignores self-loops and unresolved or external targets', () => {
		const targets: Record<string, string[]> = { a: ['Alpha', 'Inconnu', 'Beta'], b: [], c: [] };
		const resolve = (t: string) => ({ Alpha: 'a', Beta: 'b' })[t] ?? null;
		const g = buildGraph(files, (id) => targets[id] ?? [], resolve);
		expect(g.edges).toEqual([{ source: 'a', target: 'b' }]); // pas a→a, pas Inconnu
	});

	it('removes duplicate bidirectional edges', () => {
		const targets: Record<string, string[]> = { a: ['Beta'], b: ['Alpha'], c: [] };
		const resolve = (t: string) => ({ Alpha: 'a', Beta: 'b' })[t] ?? null;
		const g = buildGraph(files, (id) => targets[id] ?? [], resolve);
		expect(g.edges).toHaveLength(1); // a↔b compté une seule fois
	});
});

describe('computeLayout', () => {
	const data = buildGraph(
		files,
		(id) => (id === 'a' ? ['Beta'] : []),
		(t) => (t === 'Beta' ? 'b' : null)
	);

	it('positions each node', () => {
		const pos = computeLayout(data, { width: 400, height: 300, iterations: 20 });
		expect(pos).toHaveLength(3);
		expect(pos.map((p) => p.id).sort()).toEqual(['a', 'b', 'c']);
	});

	it('keeps positions in the frame', () => {
		const pos = computeLayout(data, { width: 400, height: 300, iterations: 50 });
		for (const p of pos) {
			expect(p.x).toBeGreaterThanOrEqual(8);
			expect(p.x).toBeLessThanOrEqual(392);
			expect(p.y).toBeGreaterThanOrEqual(8);
			expect(p.y).toBeLessThanOrEqual(292);
		}
	});

	it('returns the same positions for the same input', () => {
		const a = computeLayout(data, { width: 400, height: 300, iterations: 30 });
		const b = computeLayout(data, { width: 400, height: 300, iterations: 30 });
		expect(a).toEqual(b);
	});

	it('returns no positions for an empty graph', () => {
		expect(computeLayout({ nodes: [], edges: [] }, { width: 100, height: 100 })).toEqual([]);
	});
});
