import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	sanitizeMermaidPreviewHtml,
	stripRemoteStyleUrls,
	applyRemoteImagePolicy,
	hardenExternalLink
} from './sanitize-html';
import { sanitizePreviewHtml } from '../milkdown-mermaid-preview';

describe('stripRemoteStyleUrls', () => {
	it('rejects the complete style when it contains an https url()', () => {
		expect(
			stripRemoteStyleUrls('color:red;background:url(https://tracker.example/px.gif);width:1px')
		).toBe('');
	});

	it('removes protocol-relative url()', () => {
		expect(stripRemoteStyleUrls('list-style-image:url(//evil.example/b)')).toBe('');
	});

	it.each([
		'background:url(data:image/gif;base64,AAA)',
		'background:image-set("https://tracker.example/x" 1x)',
		'background:-webkit-\\69mage-set("https://tracker.example/x" 1x)',
		'background:image("https://tracker.example/x")',
		'background:src("https://tracker.example/x")',
		'mask:url(/local.svg)',
		'mask:url(../local.svg)',
		'background:URL("HTTPS://tracker.example/x")',
		'background:u\\72l(https://tracker.example/x)',
		'background:u/**/rl(https://tracker.example/x)',
		'background:url(\\68 ttps://tracker.example/x)',
		'background:url(\u0000https://tracker.example/x)',
		'background:url("//tracker.example/x")',
		'background:url(https://tracker.example/x'
	])('rejects obfuscated or network-capable CSS: %s', (style) => {
		expect(stripRemoteStyleUrls(style)).toBe('');
	});

	it('keeps fragment-only SVG references', () => {
		const style = 'fill:url(#gradient);mask:url("#local-mask");color:red';
		expect(stripRemoteStyleUrls(style)).toBe(style);
	});

	it.each(['fill:url   (#gradient)', "fill:url('#gradient')", 'fill:url(  #gradient  )'])(
		'keeps CSS that cannot initiate a network request: %s',
		(style) => {
			expect(stripRemoteStyleUrls(style)).toBe(style);
		}
	);

	it.each([
		'background:url()',
		'background:url("https://tracker.example/x)',
		'background:url(\\0 https://tracker.example/x)',
		'background:url(\\110000 )',
		'background:url(/* unterminated)'
	])('rejects malformed CSS URL syntax: %s', (style) => {
		expect(stripRemoteStyleUrls(style)).toBe('');
	});

	it('rejects a url function hidden by a CSS line continuation', () => {
		expect(stripRemoteStyleUrls('background:u\\\nrl(https://tracker.example/x)')).toBe('');
	});

	it('handles a large hostile input without backtracking', () => {
		const style = `${'color:red;'.repeat(100_000)}background:url(https://tracker.example/x)`;
		const startedAt = performance.now();
		expect(stripRemoteStyleUrls(style)).toBe('');
		expect(performance.now() - startedAt).toBeLessThan(500);
	});
});

describe('applyRemoteImagePolicy', () => {
	it('blocks network images and srcset before insertion into the document', () => {
		const html = applyRemoteImagePolicy(
			'<img src="https://tracker.example/pixel" srcset="/pixel-2x 2x" alt="x">',
			false
		);
		expect(html).not.toMatch(/\ssrc=/);
		expect(html).not.toMatch(/\ssrcset=/);
		expect(html).toContain('data-mdsh-remote-src="https://tracker.example/pixel"');
		expect(html).toContain('referrerpolicy="no-referrer"');
		expect(html).toContain('crossorigin="anonymous"');
	});

	it('blocks SVG image href variants while preserving local fragments', () => {
		const html = applyRemoteImagePolicy(
			'<svg><image href="https://tracker.example/a.svg" xlink:href="/b.svg"></image><image href="#local"></image></svg>',
			false
		);
		expect(html).not.toMatch(/\shref="https:\/\/tracker\.example\/a\.svg"/);
		expect(html).not.toMatch(/\sxlink:href="\/b\.svg"/);
		expect(html).toContain('data-mdsh-remote-href="https://tracker.example/a.svg"');
		expect(html).toContain('data-mdsh-remote-xlink-href="/b.svg"');
		expect(html).toContain('href="#local"');
	});
});

describe('hardenExternalLink', () => {
	it('hardens an actual SVG anchor', () => {
		const anchor = document.createElementNS('http://www.w3.org/2000/svg', 'a');
		anchor.setAttribute('href', 'https://example.test');
		hardenExternalLink(anchor);
		expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
		expect(anchor.getAttribute('target')).toBe('_blank');
	});
});

describe('WYSIWYG Mermaid preview sanitizer', () => {
	const hostile = '<div style="background:url(https://tracker.example/px.gif);color:red">x</div>';

	it('strips remote style url() on the shipped WYSIWYG preview sanitizer', async () => {
		const fromModule = await sanitizeMermaidPreviewHtml(hostile);
		const fromPreview = await sanitizePreviewHtml(hostile);
		expect(fromModule).toBe(fromPreview);
		expect(fromPreview).not.toMatch(/tracker\.example/i);
		expect(fromPreview).not.toMatch(/url\(\s*['"]?\s*https?:/i);
		expect(fromPreview).not.toContain('style=');
	});
});

describe('generated Mermaid SVG styles', () => {
	// Unlike browsers, jsdom does not create a CSSOM in createHTMLDocument.
	// The tested helper removes the temporary style sheet.
	beforeEach(() => {
		vi.spyOn(document.implementation, 'createHTMLDocument').mockReturnValue(document);
	});
	afterEach(() => vi.restoreAllMocks());
	it('keeps SVG labels, fills, specificity, and explicit styles after sanitization', async () => {
		const { inlineMermaidStyles, sanitizeHtml, MARKDOWN_PURIFY } = await import('./sanitize-html');
		const svg = `<svg id="diagram" xmlns="http://www.w3.org/2000/svg"><style>
#diagram .node rect { fill: #ececff; stroke: #9370db; }
#diagram rect { fill: black; }
#diagram text { fill: #333; font-size: 16px; }
#diagram .custom { fill: blue !important; }
#diagram .custom { fill: green; }
</style><g class="node"><rect width="70" height="54"/><text>A</text></g>
<g class="node"><rect style="fill: red"/><text>B</text></g><circle class="custom"/></svg>`;
		const html = await sanitizeHtml(inlineMermaidStyles(svg), MARKDOWN_PURIFY);
		const container = document.createElement('div');
		container.innerHTML = html;
		expect([...container.querySelectorAll('text')].map((node) => node.textContent)).toEqual([
			'A',
			'B'
		]);
		expect(container.querySelector('rect')?.style.fill).toBe('#ececff');
		expect(container.querySelectorAll('rect')[1]?.style.fill).toBe('red');
		expect(container.querySelector('circle')?.style.fill).toBe('blue');
		expect(container.querySelector('text')?.style.fill).toBe('#333');
		expect(container.querySelector('style')).toBeNull();
	});

	it('removes network and non-SVG rules but keeps internal markers', async () => {
		const { inlineMermaidStyles, sanitizeHtml, MARKDOWN_PURIFY } = await import('./sanitize-html');
		const svg = `<svg id="diagram"><style>
@import url("https://tracker.invalid/import.css");
@font-face { font-family: tracker; src: url("https://tracker.invalid/font.woff"); }
body { color:red; }
#diagram rect { fill:url(https://tracker.invalid/fill); background:url(https://tracker.invalid/pixel); position:fixed; }
#diagram path { marker-end:url(#arrow); stroke:blue; }
#diagram rect:hover { fill:green; }
</style><rect/><path/><foreignObject><div>HTML</div></foreignObject></svg>`;
		const html = await sanitizeHtml(inlineMermaidStyles(svg), MARKDOWN_PURIFY);
		expect(html).not.toContain('tracker.invalid');
		expect(html).not.toContain('foreignObject');
		expect(html).not.toContain('position');
		expect(html).not.toContain('<style');
		expect(html).toContain('marker-end: url(#arrow)');
	});

	it('does not allow styles or HTML labels in user content', async () => {
		const { sanitizeHtml, MARKDOWN_PURIFY, sanitizeMermaidPreviewHtml } =
			await import('./sanitize-html');
		const hostile =
			'<svg><style>body{background:url(https://tracker.invalid)}</style><foreignObject><p>label</p></foreignObject></svg>';
		for (const html of [
			await sanitizeHtml(hostile, MARKDOWN_PURIFY),
			await sanitizeMermaidPreviewHtml(hostile)
		]) {
			expect(html).not.toContain('<style');
			expect(html).not.toContain('foreignObject');
			expect(html).not.toContain('tracker.invalid');
		}
	});
});

describe('Mermaid checks before DOM creation', () => {
	it.each([
		'flowchart TD\nA@{ img: "https://tracker.invalid/image.png" }',
		'flowchart TD\nA@{ "i\\u006dg": "./image.png" }',
		'flowchart TD\nA@{\n"img": "data:image/png;base64,AAAA"\n}',
		'flowchart TD\nA@{ img: "file:///image.png", label: "a } b" }',
		'flowchart TD\nA@{ img: "./image.png"',
		'flowchart TD\nclassDef bad fill:u\\72l(https://tracker.invalid/paint)',
		"flowchart TD\nA@{ img: \"./image.png\", label: 'it''s a picture' }"
	])('refuse avant rendu une image ou un CSS réseau: %s', async (code) => {
		const { assertMermaidMediaSafe } = await import('./sanitize-html');
		await expect(assertMermaidMediaSafe(code)).rejects.toThrow();
	});

	it('accepts current shapes, explicit colors, and local SVG fragments', async () => {
		const { assertMermaidMediaSafe } = await import('./sanitize-html');
		await expect(
			assertMermaidMediaSafe(
				'flowchart TD\nA@{ shape: rect, label: "A" } --> B\nstyle B fill:#fee2e2\nclassDef arrow marker-end:url(#arrow)'
			)
		).resolves.toBeUndefined();
	});

	it.each([
		"flowchart TD\nA@{ label: Bob's shape, shape: rect }",
		'flowchart TD\n%% comment @{ only prose\nA --> B',
		'flowchart TD\nA@{ label: "a \\"quoted\\" label", shape: rect }'
	])(
		'accepte les commentaires et les apostrophes sans les confondre avec des images: %s',
		async (code) => {
			const { assertMermaidMediaSafe } = await import('./sanitize-html');
			await expect(assertMermaidMediaSafe(code)).resolves.toBeUndefined();
		}
	);

	it('serializes themes and resumes after a rejected render', async () => {
		const { renderMermaidSvg } = await import('./sanitize-html');
		const { default: mermaid } = await import('mermaid');
		const initialize = vi.spyOn(mermaid, 'initialize').mockImplementation(() => undefined);
		const render = vi
			.spyOn(mermaid, 'render')
			.mockRejectedValueOnce(new Error('invalid'))
			.mockResolvedValue({ svg: '<svg><text>A</text></svg>', diagramType: 'flowchart-v2' });
		try {
			const first = renderMermaidSvg('first', 'graph LR\nA-->B', 'dark');
			const second = renderMermaidSvg('second', 'graph LR\nA-->B', 'default');
			await expect(first).rejects.toThrow('invalid');
			await expect(second).resolves.toContain('<text>A</text>');
			expect(initialize.mock.calls.map(([config]) => config?.theme)).toEqual(['dark', 'default']);
			expect(initialize.mock.calls[1]?.[0]).toMatchObject({
				htmlLabels: false,
				flowchart: { htmlLabels: false },
				secure: expect.arrayContaining(['themeCSS', 'themeVariables', 'htmlLabels', 'flowchart'])
			});
		} finally {
			render.mockRestore();
			initialize.mockRestore();
		}
	});
});
