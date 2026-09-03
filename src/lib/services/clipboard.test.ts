import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Le rendu markdown est lazy-importé par copyRichHtml - on le mocke pour
// isoler la logique presse-papiers (pas de marked/DOMPurify ici).
vi.mock('../render/markdown', () => ({
	renderMarkdown: vi.fn(async (md: string) => `<rendered>${md}</rendered>`)
}));

import { copyMarkdown, copyRichHtml, isClipboardSupported } from './clipboard';

interface ClipboardMock {
	writeText: ReturnType<typeof vi.fn>;
	write: ReturnType<typeof vi.fn>;
}

let clip: ClipboardMock;

function installClipboard(c: ClipboardMock | undefined) {
	Object.defineProperty(navigator, 'clipboard', { value: c, configurable: true });
}

beforeEach(() => {
	clip = { writeText: vi.fn(async () => {}), write: vi.fn(async () => {}) };
	installClipboard(clip);
	// ClipboardItem fictif : stocke les données pour inspection.
	(globalThis as unknown as { ClipboardItem: unknown }).ClipboardItem = class {
		data: Record<string, Blob | Promise<Blob>>;
		constructor(d: Record<string, Blob | Promise<Blob>>) {
			this.data = d;
		}
	};
});

afterEach(() => {
	vi.clearAllMocks();
	delete (globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem;
});

describe('isClipboardSupported', () => {
	it('vrai quand navigator.clipboard existe', () => {
		expect(isClipboardSupported()).toBe(true);
	});
	it('faux sans navigator.clipboard', () => {
		installClipboard(undefined);
		expect(isClipboardSupported()).toBe(false);
	});
});

describe('copyMarkdown', () => {
	it('écrit le markdown brut', async () => {
		await copyMarkdown('# Titre\ncorps');
		expect(clip.writeText).toHaveBeenCalledWith('# Titre\ncorps');
	});
	it('rejette si presse-papiers indisponible', async () => {
		installClipboard(undefined);
		await expect(copyMarkdown('x')).rejects.toThrow(/indisponible/);
	});
});

describe('copyRichHtml', () => {
	it('écrit text/html + text/plain via ClipboardItem', async () => {
		await copyRichHtml('# Hi');
		expect(clip.write).toHaveBeenCalledTimes(1);
		const items = clip.write.mock.calls[0]?.[0] as Array<{
			data: Record<string, Blob | Promise<Blob>>;
		}>;
		expect(await items[0]?.data['text/html']).toBeInstanceOf(Blob);
		expect(items[0]?.data['text/plain']).toBeInstanceOf(Blob);
	});

	it('repli sur writeText(html) sans ClipboardItem', async () => {
		delete (globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem;
		await copyRichHtml('# Hi');
		expect(clip.writeText).toHaveBeenCalledWith('<rendered># Hi</rendered>');
	});

	it('rejette si presse-papiers indisponible', async () => {
		installClipboard(undefined);
		await expect(copyRichHtml('x')).rejects.toThrow(/indisponible/);
	});
});
