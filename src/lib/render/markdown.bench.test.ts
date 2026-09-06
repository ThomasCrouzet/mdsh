// @vitest-environment jsdom
//
// Performance regression benchmark for `renderMarkdown`.
// Render about 50,000 Markdown characters with 10 Mermaid diagrams, tables, highlighted code, and KaTeX math.
// The 2-second threshold prevents flakes on shared CI runners. It detects major regressions over 2x.
//
// The `[bench]` console output tracks performance changes across pull requests.

import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './markdown';

function buildLargeMarkdown(): string {
	// Build about 50,000 characters of realistic Markdown.
	// Include headings, paragraphs, lists, tables, code blocks, inline math, and 10 Mermaid diagrams.
	const sections: string[] = [];
	// Mix content to exercise all renderers.
	const para =
		'Lorem ipsum dolor sit amet, consectetur adipiscing elit. ' +
		'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. '.repeat(3);

	for (let i = 0; i < 50; i++) {
		sections.push(`## Section ${i + 1}\n\n${para}\n`);
		if (i % 5 === 0) {
			// Add a Mermaid block every five sections, for 10 blocks in total.
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

	// Add text until the document reaches at least 50,000 characters.
	const target = 50_000;
	const filler = '\n\nFiller sentence to reach target length. '.repeat(20);
	let current = sections.join('').length;
	while (current < target) {
		sections.push(filler);
		current += filler.length;
	}
	return sections.join('');
}

describe('renderMarkdown - performance benchmark', () => {
	it('renders 50,000 characters with 10 Mermaid diagrams in less than 2 seconds', async () => {
		const md = buildLargeMarkdown();
		expect(md.length).toBeGreaterThanOrEqual(50_000);

		// The first call dynamically loads marked, KaTeX, and DOMPurify.
		// Warm Mermaid and initialize the theme singleton.
		// Exclude import cost because it does not represent steady-state rendering.
		await renderMarkdown(md);

		// Run three times and use the minimum to reduce noise from garbage collection and other activity.
		const times: number[] = [];
		for (let i = 0; i < 3; i++) {
			const t0 = performance.now();
			await renderMarkdown(md);
			times.push(performance.now() - t0);
		}
		const min = Math.min(...times);
		// Log the result so CI can show performance changes across pull requests.
		console.log(
			`[bench] renderMarkdown 50k+10mermaid: min=${min.toFixed(0)}ms (runs: ${times.map((t) => t.toFixed(0)).join('/')}ms)`
		);

		// Use a wide threshold because Mermaid is slow on shared CI runners.
		// jsdom has no native canvas and uses simulated bounding boxes.
		// Detect major regressions over 2x. Do not use this benchmark as a P50 guarantee.
		expect(min).toBeLessThan(2_000);
	}, 30_000); // Use a 30-second timeout because the Mermaid warm-up can be slow.
});
