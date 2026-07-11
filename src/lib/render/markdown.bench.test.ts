// @vitest-environment jsdom
//
// Benchmark de régression perf pour `renderMarkdown`. On mesure le rendu d'un
// markdown de ~50 000 caractères contenant 10 diagrammes Mermaid + tables +
// blocs de code highlightés + math KaTeX. Le seuil est volontairement large
// (2 s) pour éviter le flake sur les runners CI partagés ; le but est de
// détecter une régression majeure (> 2x), pas de garantir le P50.
//
// La sortie console `[bench]` permet de suivre le drift au fil des PRs.

import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './markdown';

function buildLargeMarkdown(): string {
	// Construit ~50 000 caractères de markdown réaliste : headings, paragraphes,
	// listes, tables, code blocks, math inline, et 10 diagrammes Mermaid intercalés.
	const sections: string[] = [];
	// Mélange de contenu pour exercer tous les renderers.
	const para =
		'Lorem ipsum dolor sit amet, consectetur adipiscing elit. ' +
		'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. '.repeat(3);

	for (let i = 0; i < 50; i++) {
		sections.push(`## Section ${i + 1}\n\n${para}\n`);
		if (i % 5 === 0) {
			// Bloc Mermaid tous les 5 sections (10 au total : i = 0,5,10,...,45).
			sections.push(
				'```mermaid\nflowchart LR\n  A[Start] --> B{Decision}\n  B -->|Yes| C[OK]\n  B -->|No| D[KO]\n```\n\n'
			);
		}
		if (i % 3 === 0) {
			sections.push('```js\nconst x = 42;\nfunction f(y) { return y * 2; }\n```\n\n');
		}
		if (i % 4 === 0) {
			sections.push('| Col A | Col B |\n|---|---|\n| 1 | $a^2 + b^2 = c^2$ |\n| 2 | foo |\n\n');
		}
		sections.push('- item 1\n- item 2 with `inline` code\n- item 3\n\n');
	}

	// Padder pour atteindre ≥ 50k chars (on recalcule à chaque tour, car le
	// contenu de `sections` change).
	const target = 50_000;
	const filler = '\n\nFiller sentence to reach target length. '.repeat(20);
	let current = sections.join('').length;
	while (current < target) {
		sections.push(filler);
		current += filler.length;
	}
	return sections.join('');
}

describe('renderMarkdown - benchmark perf', () => {
	it('rend 50k chars avec 10 mermaid en moins de 2s (warm-up + 3 runs)', async () => {
		const md = buildLargeMarkdown();
		expect(md.length).toBeGreaterThanOrEqual(50_000);

		// Warm-up : premier appel charge dynamiquement marked + KaTeX + DOMPurify
		// + Mermaid (et initialise le singleton thème). Mesurer ce run inclurait
		// le coût d'import qui n'est pas représentatif d'un rendu en régime.
		await renderMarkdown(md);

		// 3 runs, on prend le min (le moins bruité par GC ou autre activité).
		const times: number[] = [];
		for (let i = 0; i < 3; i++) {
			const t0 = performance.now();
			await renderMarkdown(md);
			times.push(performance.now() - t0);
		}
		const min = Math.min(...times);
		// Log pour visibilité CI : trace l'évolution du coût au fil des PRs.
		console.log(
			`[bench] renderMarkdown 50k+10mermaid: min=${min.toFixed(0)}ms (runs: ${times.map((t) => t.toFixed(0)).join('/')}ms)`
		);

		// Seuil large pour ne pas flake en CI shared runners (Mermaid est lent
		// en jsdom - pas de canvas natif, mesure de bbox simulée). Le but est
		// de détecter une régression majeure (> 2x), pas de garantir le P50.
		expect(min).toBeLessThan(2_000);
	}, 30_000); // timeout 30s - Mermaid peut être lent au warm-up
});
