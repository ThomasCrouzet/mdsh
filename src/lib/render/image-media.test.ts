import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	BLOCKED_IMAGE_DATA_URI,
	editorImageSource,
	embedImageFile,
	MAX_IMAGE_BYTES,
	MediaPreparationError,
	prepareHtmlMedia,
	prepareHtmlMediaOrThrow
} from './image-media';

const PNG_BASE64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDfoAAAAASUVORK5CYII=';
const PNG_BYTES = Uint8Array.from(atob(PNG_BASE64), (character) => character.charCodeAt(0));

function pngFile(name = 'figure.png') {
	return new File([PNG_BYTES], name, { type: 'image/png' });
}

beforeEach(() =>
	vi.stubGlobal(
		'createImageBitmap',
		vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() }))
	)
);
afterEach(() => vi.unstubAllGlobals());

describe('incorporation durable', () => {
	it('conserve les octets PNG et une alternative issue du nom de fichier', async () => {
		const result = await embedImageFile(pngFile('Figure été.png'));
		expect(result.dataUri).toBe(`data:image/png;base64,${PNG_BASE64}`);
		expect(result.alt).toBe('Figure été');
		expect(result.bytes).toBe(PNG_BYTES.length);
	});

	it('rejette un faux PNG et un type actif', async () => {
		await expect(
			embedImageFile(new File(['<script>bad</script>'], 'fake.png', { type: 'image/png' }))
		).rejects.toMatchObject({ code: 'invalid-content' });
		await expect(
			embedImageFile(new File(['html'], 'fake.html', { type: 'text/html' }))
		).rejects.toMatchObject({ code: 'unsupported-type' });
	});

	it('rejette le poids avant lecture et les dimensions après décodage', async () => {
		await expect(
			embedImageFile(
				new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], 'large.png', { type: 'image/png' })
			)
		).rejects.toMatchObject({ code: 'too-large' });
		const close = vi.fn();
		vi.stubGlobal(
			'createImageBitmap',
			vi.fn(async () => ({ width: 20_000, height: 20_000, close }))
		);
		await expect(embedImageFile(pngFile())).rejects.toMatchObject({ code: 'dimensions' });
		expect(close).toHaveBeenCalledOnce();
	});

	it('vérifie aussi les pixels via Image.decode lorsque createImageBitmap est absent', async () => {
		vi.stubGlobal('createImageBitmap', undefined);
		const decode = vi.fn(async () => {});
		vi.stubGlobal(
			'Image',
			class {
				naturalWidth = 192;
				naturalHeight = 192;
				decode = decode;
				removeAttribute() {}
			}
		);
		const result = await embedImageFile(pngFile());
		expect(result.width).toBe(192);
		expect(decode).toHaveBeenCalledOnce();
	});

	it('supprime les sous-ressources réseau d’un SVG incorporé', async () => {
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><filter id="f"><feImage href="https://tracker.example/pixel"/></filter><rect width="10" height="10" fill="red"/></svg>';
		const result = await embedImageFile(new File([svg], 'figure.svg', { type: 'image/svg+xml' }));
		const decoded = atob(result.dataUri.split(',')[1] ?? '');
		expect(decoded).toContain('<rect');
		expect(decoded).not.toContain('tracker.example');
		expect(decoded).not.toContain('feImage');
	});
});

describe('politique et préparation des exports', () => {
	it('ne démarre aucune requête sans consentement', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		const result = await prepareHtmlMedia(
			'<img data-mdsh-remote-src="https://images.example/figure.png" alt="Figure">',
			{ allowNetwork: false }
		);
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(result.issues).toEqual([
			{ source: 'https://images.example/figure.png', reason: 'blocked' }
		]);
		await expect(
			prepareHtmlMediaOrThrow('<img src="relative.png">', { allowNetwork: false })
		).rejects.toBeInstanceOf(MediaPreparationError);
	});

	it('incorpore une ressource consentie sans credentials ni référent', async () => {
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
		const result = await prepareHtmlMedia(
			'<img data-mdsh-remote-src="https://images.example/figure.png" alt="Figure">',
			{ allowNetwork: true }
		);
		expect(fetchSpy).toHaveBeenCalledWith(
			'https://images.example/figure.png',
			expect.objectContaining({
				credentials: 'omit',
				referrerPolicy: 'no-referrer',
				signal: expect.any(AbortSignal)
			})
		);
		expect(result.issues).toEqual([]);
		expect(result.html).toContain(`src="data:image/png;base64,${PNG_BASE64}"`);
		expect(result.html).not.toContain('data-mdsh-remote-src');
	});

	it('retourne un diagnostic sur un HTTP refusé et une image illisible', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: false, status: 404 }))
		);
		const missing = await prepareHtmlMedia('<img src="missing.png">', { allowNetwork: true });
		expect(missing.issues[0]?.reason).toBe('fetch-failed');
		const malformed = await prepareHtmlMedia('<img src="data:image/png;base64,AAAA">', {
			allowNetwork: false
		});
		expect(malformed.issues[0]?.reason).toBe('invalid-content');
	});

	it('borne le flux même si Content-Length est absent ou mensonger', async () => {
		const cancel = vi.fn();
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(new Uint8Array(MAX_IMAGE_BYTES + 1));
			},
			cancel
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: true,
				headers: new Headers({ 'content-length': '10', 'content-type': 'image/png' }),
				body: stream
			}))
		);
		const result = await prepareHtmlMedia('<img src="https://images.example/large.png">', {
			allowNetwork: true
		});
		expect(result.issues[0]?.reason).toBe('too-large');
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('refuse credentials, HTTP tiers et blobs étrangers sans requête', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		const result = await prepareHtmlMedia(
			'<img src="https://user:secret@images.example/a.png"><img src="http://images.example/b.png"><img src="blob:https://other.example/id">',
			{ allowNetwork: true }
		);
		expect(result.issues).toHaveLength(3);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('applique le ratio à partir des dimensions décodées', async () => {
		vi.stubGlobal(
			'createImageBitmap',
			vi.fn(async () => ({ width: 192, height: 192, close: vi.fn() }))
		);
		const result = await prepareHtmlMedia(
			`<img src="data:image/png;base64,${PNG_BASE64}" data-mdsh-image-ratio="0.5">`,
			{ allowNetwork: false }
		);
		expect(result.html).toContain('width:min(50%,96px)');
		expect(result.issues).toEqual([]);
	});

	it('neutralise les sources WYSIWYG distantes avant création de l’image', () => {
		expect(editorImageSource('')).toBe('');
		expect(editorImageSource('https://tracker.example/pixel')).toBe(BLOCKED_IMAGE_DATA_URI);
		expect(editorImageSource('images/local.png')).toBe(BLOCKED_IMAGE_DATA_URI);
		expect(editorImageSource('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
	});
});

describe('validation des limites et erreurs de lecture', () => {
	it.each([
		['photo.jpg', [255, 216, 255], 'image/jpeg'],
		['photo.jpeg', [255, 216, 255], 'image/jpeg'],
		['photo.gif', [...new TextEncoder().encode('GIF87a')], 'image/gif'],
		['photo.gif', [...new TextEncoder().encode('GIF89a')], 'image/gif'],
		['photo.webp', [...new TextEncoder().encode('RIFF0000WEBP')], 'image/webp'],
		['photo.avif', [...new TextEncoder().encode('0000ftypavif')], 'image/avif'],
		['photo.avif', [...new TextEncoder().encode('0000ftypavis')], 'image/avif'],
		['photo.png', [...PNG_BYTES], 'image/png'],
		[
			'photo.svg',
			[...new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')],
			'image/svg+xml'
		]
	])('déduit le format de %s uniquement pour un type non déclaré', async (name, bytes, mime) => {
		const result = await embedImageFile(
			new File([new Uint8Array(bytes)], name, { type: 'application/octet-stream' })
		);
		expect(result.mime).toBe(mime);
	});

	it.each(['jpeg', 'gif', 'webp', 'avif', 'svg+xml'])(
		'refuse une signature invalide pour %s',
		async (type) => {
			await expect(
				embedImageFile(new File(['wrong'], 'image', { type: `image/${type}` }))
			).rejects.toMatchObject({ code: 'invalid-content' });
		}
	);

	it('refuse un fichier sans extension et les SVG avec ressources externes', async () => {
		await expect(embedImageFile(new File([PNG_BYTES], 'unknown'))).rejects.toMatchObject({
			code: 'unsupported-type'
		});
		await expect(
			embedImageFile(
				new File(
					[
						'<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.org/a.png"/></svg>'
					],
					'image.svg'
				)
			)
		).rejects.toMatchObject({ code: 'invalid-content' });
	});

	it.each(['error', 'invalid-result'])('signale un FileReader %s', async (mode) => {
		vi.stubGlobal(
			'FileReader',
			class {
				result = 'invalid';
				onload?: () => void;
				onerror?: () => void;
				readAsArrayBuffer() {
					queueMicrotask(() => (mode === 'error' ? this.onerror?.() : this.onload?.()));
				}
			}
		);
		await expect(embedImageFile(pngFile())).rejects.toMatchObject({ code: 'unreadable' });
	});

	it.each([
		[0, 1],
		[1, 0],
		[1, 9000],
		[6000, 6000]
	])('rejette des dimensions %sx%s', async (width, height) => {
		vi.stubGlobal(
			'createImageBitmap',
			vi.fn(async () => ({ width, height, close: vi.fn() }))
		);
		await expect(embedImageFile(pngFile())).rejects.toMatchObject({
			code: width === 0 || height === 0 ? 'unreadable' : 'dimensions'
		});
	});

	it.each(['load', 'error', 'zero'])('décodage WebKit sans decode : %s', async (mode) => {
		vi.stubGlobal('createImageBitmap', undefined);
		vi.stubGlobal(
			'Image',
			class {
				naturalWidth = mode === 'zero' ? 0 : 1;
				naturalHeight = 1;
				onload?: () => void;
				onerror?: () => void;
				set src(_value: string) {
					queueMicrotask(() => (mode === 'error' ? this.onerror?.() : this.onload?.()));
				}
				removeAttribute() {}
			}
		);
		if (mode === 'load') expect((await embedImageFile(pngFile())).width).toBe(1);
		else await expect(embedImageFile(pngFile())).rejects.toMatchObject({ code: 'unreadable' });
	});

	it('interrompt un décodage WebKit qui ne répond pas', async () => {
		vi.useFakeTimers();
		vi.stubGlobal('createImageBitmap', undefined);
		vi.stubGlobal(
			'Image',
			class {
				removeAttribute() {}
			}
		);
		const file = pngFile();
		Object.defineProperty(file, 'arrayBuffer', { value: async () => PNG_BYTES.buffer });
		const assertion = expect(embedImageFile(file)).rejects.toMatchObject({ code: 'unreadable' });
		await vi.advanceTimersByTimeAsync(10_000);
		await assertion;
		vi.useRealTimers();
	});

	it('valide les données percent-encoded et refuse leurs variantes corrompues', async () => {
		const svg = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>');
		expect(
			(await prepareHtmlMedia(`<img src="data:image/svg+xml,${svg}">`, { allowNetwork: false }))
				.issues
		).toEqual([]);
		for (const source of [
			'data:broken',
			'data:image/png;base64,??',
			'data:image/png,%ZZ',
			`data:image/png;base64,${'A'.repeat(MAX_IMAGE_BYTES * 1.5 + 1025)}`,
			'data:text/html;base64,YQ=='
		]) {
			expect(
				(await prepareHtmlMedia(`<img src="${source}">`, { allowNetwork: false })).issues
			).toHaveLength(1);
		}
	});

	it('diagnostique sources manquantes, srcset et blobs expirés sans les perdre', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('expired');
			})
		);
		const blob = `blob:${window.location.origin}/expired`;
		const result = await prepareHtmlMedia(
			`<img><img alt="Absent"><img src="data:image/png;base64,${PNG_BASE64}" srcset="a.png 2x"><img src="data:image/png;base64,${PNG_BASE64}" data-mdsh-remote-srcset="b.png 2x"><img src="${blob}">`,
			{ allowNetwork: false }
		);
		expect(result.issues.map((issue) => issue.reason)).toEqual([
			'unreadable',
			'unreadable',
			'unsupported-srcset',
			'unsupported-srcset',
			'fetch-failed'
		]);
		expect(result.html).toContain(`data-mdsh-media-src="${blob}"`);
		expect((await prepareHtmlMedia(result.html, { allowNetwork: false })).issues).toHaveLength(3);
	});

	it('vérifie la limite cumulée avant de lancer une requête supplémentaire', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		const result = await prepareHtmlMedia(
			`<img alt="A" src="data:image/png;base64,${PNG_BASE64}"><img src="next.png">`,
			{ allowNetwork: true, maxTotalBytes: 1 }
		);
		expect(result.issues.map((issue) => issue.reason)).toEqual(['too-large', 'too-large']);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it.each(['large-header', 'missing-stream'])('refuse une réponse %s', async (mode) => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: true,
				headers: new Headers(
					mode === 'large-header' ? { 'content-length': String(MAX_IMAGE_BYTES + 1) } : {}
				),
				body: null
			}))
		);
		const result = await prepareHtmlMedia('<img src="https://example.org/a.png">', {
			allowNetwork: true
		});
		expect(result.issues[0]?.reason).toBe(mode === 'large-header' ? 'too-large' : 'unreadable');
	});

	it('incorpore les références SVG et retrouve un MIME absent dans le nom', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: true,
				headers: new Headers(),
				body: new ReadableStream({
					start(controller) {
						controller.enqueue(PNG_BYTES);
						controller.close();
					}
				})
			}))
		);
		const result = await prepareHtmlMedia(
			'<svg><image href="https://example.org/a.png"/><image data-mdsh-remote-xlink-href="https://example.org/b.png"/></svg>',
			{ allowNetwork: true }
		);
		expect(result.embedded).toBe(2);
		expect(result.issues).toEqual([]);
		expect(result.html).not.toContain('https://');
	});

	it('rend le HTML sans DOM et expose le besoin de consentement exact', async () => {
		vi.stubGlobal('document', undefined);
		expect(await prepareHtmlMedia('plain', { allowNetwork: false })).toEqual({
			html: 'plain',
			issues: [],
			embedded: 0
		});
		expect(
			new MediaPreparationError([{ source: 'a', reason: 'blocked' }]).needsNetworkConsent
		).toBe(true);
		expect(
			new MediaPreparationError([{ source: 'a', reason: 'unreadable' }]).needsNetworkConsent
		).toBe(false);
	});
});

describe('schémas et fragments des images exportées', () => {
	it.each(['DATA:IMAGE/PNG;BASE64,', 'data:image/png;charset=UTF-8;base64,'])(
		'reconnaît %s sans accès réseau',
		async (prefix) => {
			const fetchSpy = vi.fn();
			vi.stubGlobal('fetch', fetchSpy);
			const html = await prepareHtmlMediaOrThrow(`<img src="${prefix}${PNG_BASE64}">`, {
				allowNetwork: false
			});
			expect(html).toContain(`src="data:image/png;base64,${PNG_BASE64}"`);
			expect(fetchSpy).not.toHaveBeenCalled();
		}
	);

	it('valide un SVG UTF-8 percent-encoded avec charset explicite', async () => {
		const source = encodeURIComponent(
			'<svg xmlns="http://www.w3.org/2000/svg"><text>Été</text></svg>'
		);
		const html = await prepareHtmlMediaOrThrow(
			`<img src="data:image/svg+xml;charset=utf-8,${source}">`,
			{ allowNetwork: false }
		);
		expect(html).toContain('src="data:image/svg+xml;base64,');
	});

	it('rejette un fragment img mais préserve les références SVG internes', async () => {
		const fragment = '<svg><defs><g id="drawing"/></defs><image href="#drawing"/></svg>';
		await expect(
			prepareHtmlMediaOrThrow(`<img src="#drawing">${fragment}`, { allowNetwork: false })
		).rejects.toMatchObject({ issues: [{ source: '#drawing', reason: 'invalid-content' }] });
		expect(await prepareHtmlMediaOrThrow(fragment, { allowNetwork: false })).toContain(
			'href="#drawing"'
		);
	});

	it('récupère un blob avec schéma en majuscules sans consentement réseau', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: true,
				headers: new Headers({ 'content-type': 'image/png' }),
				body: new ReadableStream({
					start(controller) {
						controller.enqueue(PNG_BYTES);
						controller.close();
					}
				})
			}))
		);
		const result = await prepareHtmlMedia(`<img src="BLOB:${window.location.origin}/image">`, {
			allowNetwork: false
		});
		expect(result.issues).toEqual([]);
		expect(result.embedded).toBe(1);
		expect(result.html).toContain(`src="data:image/png;base64,${PNG_BASE64}"`);
	});
});
