import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { incorporateDocumentImages, markdownImageDestinations } from './document-media';

const PNG_BYTES = Uint8Array.from(
	atob(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDfoAAAAASUVORK5CYII='
	),
	(character) => character.charCodeAt(0)
);

beforeEach(() =>
	vi.stubGlobal(
		'createImageBitmap',
		vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() }))
	)
);
afterEach(() => vi.unstubAllGlobals());

describe('ressources Markdown sélectionnées', () => {
	it('trouve chemins Unicode, espaces encadrés et parenthèses sans toucher au code', () => {
		const markdown =
			'![Été](<images/été 2026.png>)\n\n![Parenthèse](images/a(b).png)\n\n`![Code](ignore.png)`\n\n```md\n![Code](ignore2.png)\n```';
		expect(markdownImageDestinations(markdown).map((item) => item.source)).toEqual([
			'images/été 2026.png',
			'images/a(b).png'
		]);
	});

	it('incorpore uniquement le fichier explicitement sélectionné qui correspond au chemin', async () => {
		const file = new File([PNG_BYTES], 'été 2026.png', { type: 'image/png' });
		Object.defineProperty(file, 'webkitRelativePath', { value: 'rapport/images/été 2026.png' });
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		const result = await incorporateDocumentImages('![Été](<images/été 2026.png> "Légende")', {
			files: [file]
		});
		expect(result.markdown).toContain('![Été](<data:image/png;base64,');
		expect(result.markdown).toContain('> "Légende")');
		expect(result.embedded).toBe(1);
		expect(result.issues).toEqual([]);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('refuse une traversée et un choix ambigu au lieu de lire un voisin implicite', async () => {
		const first = new File([PNG_BYTES], 'figure.png', { type: 'image/png' });
		const second = new File([PNG_BYTES], 'figure.png', { type: 'image/png' });
		const traversal = await incorporateDocumentImages('![Figure](../figure.png)', {
			files: [first]
		});
		expect(traversal.embedded).toBe(0);
		expect(traversal.issues).toHaveLength(1);
		const ambiguous = await incorporateDocumentImages('![Figure](images/figure.png)', {
			files: [first, second]
		});
		expect(ambiguous.embedded).toBe(0);
		expect(ambiguous.issues).toHaveLength(1);
	});
});

describe('parcours de ressources mixtes', () => {
	it('analyse HTML, SVG, alternatives imbriquées et destinations échappées sans inclure le code', () => {
		const source =
			'<img href="ignored" src="a.png?x=1&amp;y=2"><image xlink:href=svg.png /><img src=\'single.png\'><img src="">\n![a [b] \\]]( a\\(b\\).png "title")\n\\![escaped](skip.png) ![empty]() ![broken]\n``![code](skip.png) ` nested``\n~~~md\n![code](skip2.png)\n```\n~~~\n![last](last.png)';
		expect(markdownImageDestinations(source).map(({ source }) => source)).toEqual([
			'a.png?x=1&y=2',
			'svg.png',
			'single.png',
			'a(b).png',
			'last.png'
		]);
	});

	it('ne lance rien sans consentement, ignore data et fragments', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		const result = await incorporateDocumentImages(
			'![remote](https://example.org/a.png) ![data](data:image/png;base64,a) ![fragment](#a)',
			{}
		);
		expect(result.issues).toEqual([{ source: 'https://example.org/a.png', reason: 'blocked' }]);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('remplace HTML et Markdown identiques à partir d’un seul téléchargement explicite', async () => {
		const fetchSpy = vi.fn(async () => ({
			ok: true,
			headers: new Headers({ 'content-type': 'image/png' }),
			body: new ReadableStream({
				start(controller) {
					controller.enqueue(PNG_BYTES);
					controller.close();
				}
			})
		}));
		vi.stubGlobal('fetch', fetchSpy);
		const result = await incorporateDocumentImages(
			'<img src="https://example.org/a.png">\n![Alt](https://example.org/a.png)',
			{ allowNetwork: true }
		);
		expect(fetchSpy).toHaveBeenCalledOnce();
		expect(result.embedded).toBe(1);
		expect(result.markdown.match(/data:image\/png;base64,/g)).toHaveLength(2);
	});

	it('préserve le texte lors d’une erreur de téléchargement', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('offline');
			})
		);
		const source = '![Alt](https://example.org/a.png)';
		const result = await incorporateDocumentImages(source, { allowNetwork: true });
		expect(result.markdown).toBe(source);
		expect(result.issues).toEqual([{ source: 'https://example.org/a.png', reason: 'unreadable' }]);
	});

	it.each(['images/figure.png', 'https://example.org/images/figure.png', './figure.png?version=1'])(
		'retrouve un nom unique sélectionné pour %s',
		async (source) => {
			const result = await incorporateDocumentImages(`![Alt](${source})`, {
				files: [new File([PNG_BYTES], 'figure.png', { type: 'image/png' })]
			});
			expect(result.embedded).toBe(1);
		}
	);

	it.each(['%ZZ.png', '%2e%2e/figure.png', 'https://[invalid/figure.png', '/'])(
		'refuse le chemin inexploitable %s',
		async (source) => {
			const result = await incorporateDocumentImages(`![Alt](${source})`, {
				files: [new File([PNG_BYTES], 'figure.png', { type: 'image/png' })]
			});
			expect(result.embedded).toBe(0);
			expect(result.issues).toHaveLength(1);
		}
	);

	it('borne le cumul de fichiers choisis et conserve les sources au-delà de la limite', async () => {
		const bytes = new Uint8Array(2 * 1024 * 1024);
		bytes.set(PNG_BYTES);
		const files = Array.from(
			{ length: 5 },
			(_, index) => new File([bytes], `${index}.png`, { type: 'image/png' })
		);
		const result = await incorporateDocumentImages(
			files.map((file) => `![Alt](${file.name})`).join('\n'),
			{ files }
		);
		expect(result.embedded).toBe(4);
		expect(result.issues).toEqual([{ source: '4.png', reason: 'too-large' }]);
		expect(result.markdown).toContain('![Alt](4.png)');
	});
});

describe('schémas locaux indépendants de la casse', () => {
	it('récupère une URL BLOB et laisse une URL DATA déjà durable intacte', async () => {
		const fetchSpy = vi.fn(async () => ({
			ok: true,
			headers: new Headers({ 'content-type': 'image/png' }),
			body: new ReadableStream({
				start(controller) {
					controller.enqueue(PNG_BYTES);
					controller.close();
				}
			})
		}));
		vi.stubGlobal('fetch', fetchSpy);
		const result = await incorporateDocumentImages(
			`![Blob](BLOB:${window.location.origin}/image)\n![Data](DATA:image/png;base64,AAAA)`,
			{}
		);
		expect(result.issues).toEqual([]);
		expect(result.embedded).toBe(1);
		expect(result.markdown).toContain('![Blob](data:image/png;base64,');
		expect(result.markdown).toContain('![Data](DATA:image/png;base64,AAAA)');
		expect(fetchSpy).toHaveBeenCalledOnce();
	});
});
