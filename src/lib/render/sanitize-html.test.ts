import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderMarkdown } from './markdown';
import {
	sanitizeMermaidPreviewHtml,
	stripRemoteStyleUrls,
	neutralizeRemoteStyleUrls,
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

	it.each([
		'',
		'color:red',
		'color:\\red',
		'content:url-label',
		'fill:url   (#gradient)',
		"fill:url('#gradient')",
		'fill:url(  #gradient  )'
	])('keeps CSS that cannot initiate a network request: %s', (style) => {
		expect(stripRemoteStyleUrls(style)).toBe(style);
	});

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

describe('neutralizeRemoteStyleUrls', () => {
	it('writes the cleaned style back onto the node', () => {
		const attrs: Record<string, string> = {
			style: 'background:url(https://tracker.example/x)'
		};
		const node = {
			hasAttribute: (n: string) => n in attrs,
			getAttribute: (n: string) => attrs[n] ?? null,
			setAttribute: (n: string, v: string) => {
				attrs[n] = v;
			},
			removeAttribute: (n: string) => {
				delete attrs[n];
			}
		};
		neutralizeRemoteStyleUrls(node);
		expect(attrs.style).toBeUndefined();
	});

	it('leaves safe styles unchanged and ignores nodes without style access', () => {
		const attrs: Record<string, string> = { style: 'fill:url(#gradient)' };
		neutralizeRemoteStyleUrls({
			hasAttribute: (name) => name in attrs,
			getAttribute: (name) => attrs[name] ?? null,
			removeAttribute: (name) => delete attrs[name]
		});
		expect(attrs.style).toBe('fill:url(#gradient)');
		expect(() => neutralizeRemoteStyleUrls({})).not.toThrow();
		expect(() =>
			neutralizeRemoteStyleUrls({
				hasAttribute: () => true,
				getAttribute: () => null,
				removeAttribute: () => undefined
			})
		).not.toThrow();
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

	it('keeps embedded data images without consent', () => {
		const html = applyRemoteImagePolicy('<img src="data:image/png;base64,AA==" alt="x">', false);
		expect(html).toContain('src="data:image/png;base64,AA=="');
		expect(html).not.toContain('data-mdsh-remote-src=');
	});

	it('keeps network images only after explicit consent', () => {
		const html = applyRemoteImagePolicy('<img src="https://example.test/x.png">', true);
		expect(html).toContain('src="https://example.test/x.png"');
		expect(html).not.toContain('data-mdsh-remote-src=');
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

	it('leaves empty and embedded image sources local', () => {
		const html = applyRemoteImagePolicy(
			'<img src=""><img src="blob:local"><img src="#fragment">',
			false
		);
		expect(html).not.toContain('data-mdsh-remote-src=');
	});

	it('is a no-op during server-side rendering', () => {
		const originalDocument = document;
		vi.stubGlobal('document', undefined);
		expect(applyRemoteImagePolicy('<img src="https://example.test/x">', false)).toContain(
			'https://example.test/x'
		);
		vi.stubGlobal('document', originalDocument);
	});
});

describe('hardenExternalLink', () => {
	it('hardens only external anchors', () => {
		const attrs: Record<string, string> = { href: 'https://example.test' };
		hardenExternalLink({
			tagName: 'A',
			hasAttribute: (name) => name in attrs,
			getAttribute: (name) => attrs[name] ?? null,
			setAttribute: (name, value) => {
				attrs[name] = value;
			}
		});
		expect(attrs).toMatchObject({ target: '_blank', rel: 'noopener noreferrer' });
		expect(() =>
			hardenExternalLink({
				tagName: 'A',
				hasAttribute: () => true,
				getAttribute: () => 'https://example.test'
			})
		).not.toThrow();
		expect(() => hardenExternalLink({ tagName: 'DIV' })).not.toThrow();
		expect(() => hardenExternalLink({ tagName: 'A', hasAttribute: () => false })).not.toThrow();
	});
});

describe('read path vs WYSIWYG Mermaid preview sanitizer', () => {
	const hostile = '<div style="background:url(https://tracker.example/px.gif);color:red">x</div>';

	it('strips remote style url() on the read / export path (renderMarkdown)', async () => {
		const html = await renderMarkdown(hostile);
		expect(html).not.toMatch(/tracker\.example/i);
		expect(html).not.toMatch(/url\(\s*['"]?\s*https?:/i);
	});

	it('strips remote style url() on the shipped WYSIWYG preview sanitizer', async () => {
		const fromModule = await sanitizeMermaidPreviewHtml(hostile);
		const fromPreview = await sanitizePreviewHtml(hostile);
		expect(fromModule).toBe(fromPreview);
		expect(fromPreview).not.toMatch(/tracker\.example/i);
		expect(fromPreview).not.toMatch(/url\(\s*['"]?\s*https?:/i);
		expect(fromPreview).not.toContain('style=');
	});

	it('blocks remote Markdown images by default', async () => {
		const html = await renderMarkdown('![pixel](https://tracker.example/pixel.gif)');
		expect(html).not.toMatch(/\ssrc="https?:/i);
		expect(html).toContain('data-mdsh-remote-src="https://tracker.example/pixel.gif"');
	});

	it('allows remote Markdown images after explicit consent', async () => {
		const html = await renderMarkdown('![pixel](https://images.example/pixel.gif)', {
			allowRemoteImages: true
		});
		expect(html).toContain('src="https://images.example/pixel.gif"');
		expect(html).toContain('referrerpolicy="no-referrer"');
	});
});

describe('styles du SVG Mermaid généré', () => {
	// jsdom ne crée pas de CSSOM dans createHTMLDocument, contrairement aux
	// navigateurs. La feuille temporaire est retirée par le helper testé.
	beforeEach(() => {
		vi.spyOn(document.implementation, 'createHTMLDocument').mockReturnValue(document);
	});
	afterEach(() => vi.restoreAllMocks());
	it('conserve labels SVG, remplissages, spécificité et styles explicites après sanitation', async () => {
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

	it('ignore règles réseau et effets hors SVG tout en conservant les marqueurs internes', async () => {
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

	it('ne réautorise ni les styles ni les labels HTML dans les contenus utilisateur', async () => {
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

describe('précontrôle Mermaid avant création DOM', () => {
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

	it('accepte formes récentes, couleurs explicites et fragments SVG locaux', async () => {
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

	it('sérialise les thèmes et reprend après un rendu rejeté', async () => {
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
