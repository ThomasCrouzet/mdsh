import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { printOnDesktop } from './print-desktop';

const print = vi.fn();
const completions: Array<(value: boolean) => void> = [];
vi.mock('../platform', () => ({ isMac: () => true }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => print(...args) }));
beforeEach(() => {
	vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
		fn(0);
		return 1;
	});
	print.mockImplementation(() => new Promise<boolean>((resolve) => completions.push(resolve)));
	document.title = 'Editor';
});
afterEach(async () => {
	for (const complete of completions.splice(0)) complete(true);
	await Promise.resolve();
	await Promise.resolve();
	document.body.replaceChildren();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	print.mockReset();
});

describe('native print isolation', () => {
	it('loads only local export styles and resolves their font URLs', async () => {
		const fetch = vi.fn(
			async () =>
				new Response('body { font: 12px Test; } @font-face { src:url(fonts/Test.woff2); }')
		);
		vi.stubGlobal('fetch', fetch);
		void printOnDesktop(
			'<link rel="stylesheet" href="http://localhost:5173/katex/katex.min.css"><body>Math</body>'
		);
		await vi.waitFor(() => expect(print).toHaveBeenCalledOnce());
		expect(fetch).toHaveBeenCalledOnce();
		expect(document.getElementById('mdsh-native-print')?.shadowRoot?.textContent).toContain(
			'http://localhost:5173/katex/fonts/Test.woff2'
		);
	});
	it('refuses external stylesheets without issuing a request', async () => {
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);
		await expect(
			printOnDesktop(
				'<link rel="stylesheet" href="https://example.org/print/print.css"><body>Text</body>'
			)
		).rejects.toThrow('Unexpected');
		expect(fetch).not.toHaveBeenCalled();
		expect(print).not.toHaveBeenCalled();
		expect(document.getElementById('mdsh-native-print')).toBeNull();
	});
	it('fails on a missing stylesheet and never opens a partial print', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('', { status: 404 }))
		);
		await expect(
			printOnDesktop(
				'<link rel="stylesheet" href="http://localhost:5173/print/print.css"><body>Text</body>'
			)
		).rejects.toThrow('404');
		expect(print).not.toHaveBeenCalled();
	});
	it('rejects simultaneous printing and permits another print after cleanup', async () => {
		const first = printOnDesktop('<body>First</body>');
		await vi.waitFor(() => expect(print).toHaveBeenCalledOnce());
		await expect(printOnDesktop('<body>Second</body>')).rejects.toThrow('already active');
		completions.shift()?.(true);
		await first;
		void printOnDesktop('<body>Second</body>');
		await vi.waitFor(() => expect(print).toHaveBeenCalledTimes(2));
	});
	it('cleans up on printing failure or cancellation', async () => {
		print.mockImplementationOnce(() => {
			throw new Error('Printer offline');
		});
		await expect(printOnDesktop('<title>Doc</title><body>Text</body>')).rejects.toThrow(
			'Printer offline'
		);
		expect(document.title).toBe('Editor');
		expect(document.getElementById('mdsh-native-print')).toBeNull();
		const controller = new AbortController();
		controller.abort();
		await expect(
			printOnDesktop('<body>Text</body>', { signal: controller.signal })
		).rejects.toMatchObject({ name: 'AbortError' });
		const active = new AbortController();
		void printOnDesktop('<body>Text</body>', { signal: active.signal });
		await vi.waitFor(() => expect(print).toHaveBeenCalledTimes(2));
		active.abort();
		expect(document.getElementById('mdsh-native-print')).toBeNull();
	});
});
