import { describe, it, expect } from 'vitest';
import { buildGraph, computeLayout } from './graph';

const files = [
	{ id: 'a', label: 'Alpha' },
	{ id: 'b', label: 'Beta' },
	{ id: 'c', label: 'Gamma' }
];

describe('buildGraph', () => {
	it('crée un nœud par fichier', () => {
		const g = buildGraph(
			files,
			() => [],
			() => null
		);
		expect(g.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
		expect(g.edges).toEqual([]);
	});

	it('résout les wiki-links en arêtes', () => {
		const targets: Record<string, string[]> = { a: ['Beta'], b: ['Gamma'], c: [] };
		const resolve = (t: string) => ({ Alpha: 'a', Beta: 'b', Gamma: 'c' })[t] ?? null;
		const g = buildGraph(files, (id) => targets[id] ?? [], resolve);
		expect(g.edges).toEqual([
			{ source: 'a', target: 'b' },
			{ source: 'b', target: 'c' }
		]);
	});

	it('ignore les self-loops et les cibles non résolues / externes', () => {
		const targets: Record<string, string[]> = { a: ['Alpha', 'Inconnu', 'Beta'], b: [], c: [] };
		const resolve = (t: string) => ({ Alpha: 'a', Beta: 'b' })[t] ?? null;
		const g = buildGraph(files, (id) => targets[id] ?? [], resolve);
		expect(g.edges).toEqual([{ source: 'a', target: 'b' }]); // pas a→a, pas Inconnu
	});

	it('déduplique les arêtes bidirectionnelles', () => {
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

	it('positionne chaque nœud', () => {
		const pos = computeLayout(data, { width: 400, height: 300, iterations: 20 });
		expect(pos).toHaveLength(3);
		expect(pos.map((p) => p.id).sort()).toEqual(['a', 'b', 'c']);
	});

	it('garde les positions dans le cadre', () => {
		const pos = computeLayout(data, { width: 400, height: 300, iterations: 50 });
		for (const p of pos) {
			expect(p.x).toBeGreaterThanOrEqual(8);
			expect(p.x).toBeLessThanOrEqual(392);
			expect(p.y).toBeGreaterThanOrEqual(8);
			expect(p.y).toBeLessThanOrEqual(292);
		}
	});

	it('est déterministe (mêmes entrées → mêmes positions)', () => {
		const a = computeLayout(data, { width: 400, height: 300, iterations: 30 });
		const b = computeLayout(data, { width: 400, height: 300, iterations: 30 });
		expect(a).toEqual(b);
	});

	it('graphe vide → aucune position', () => {
		expect(computeLayout({ nodes: [], edges: [] }, { width: 100, height: 100 })).toEqual([]);
	});
});
