import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// copyRichHtml imports the Markdown renderer lazily. Mock it to
// isolate clipboard logic without marked or DOMPurify.
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
	// Store data in a fake ClipboardItem for inspection.
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
	it('returns true when navigator.clipboard exists', () => {
		expect(isClipboardSupported()).toBe(true);
	});
	it('returns false without navigator.clipboard', () => {
		installClipboard(undefined);
		expect(isClipboardSupported()).toBe(false);
	});
});

describe('copyMarkdown', () => {
	it('writes raw Markdown', async () => {
		await copyMarkdown('# Titre\ncorps');
		expect(clip.writeText).toHaveBeenCalledWith('# Titre\ncorps');
	});
	it('rejects when the clipboard is unavailable', async () => {
		installClipboard(undefined);
		await expect(copyMarkdown('x')).rejects.toThrow(/indisponible/);
	});
});

describe('copyRichHtml', () => {
	it('writes text/html and text/plain through ClipboardItem', async () => {
		await copyRichHtml('# Hi');
		expect(clip.write).toHaveBeenCalledTimes(1);
		const items = clip.write.mock.calls[0]?.[0] as Array<{
			data: Record<string, Blob | Promise<Blob>>;
		}>;
		expect(await items[0]?.data['text/html']).toBeInstanceOf(Blob);
		expect(items[0]?.data['text/plain']).toBeInstanceOf(Blob);
	});

	it('uses writeText with HTML when ClipboardItem is unavailable', async () => {
		delete (globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem;
		await copyRichHtml('# Hi');
		expect(clip.writeText).toHaveBeenCalledWith('<rendered># Hi</rendered>');
	});

	it('rejects when the clipboard is unavailable', async () => {
		installClipboard(undefined);
		await expect(copyRichHtml('x')).rejects.toThrow(/indisponible/);
	});
});
