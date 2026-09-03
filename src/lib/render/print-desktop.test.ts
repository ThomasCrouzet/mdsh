import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { printOnDesktop } from './print-desktop';

const print = vi.fn();
beforeEach(() => {
	vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
		fn(0);
		return 1;
	});
	vi.spyOn(window, 'print').mockImplementation(print);
	document.title = 'Editor';
});
afterEach(() => {
	window.dispatchEvent(new Event('afterprint'));
	document.body.replaceChildren();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	print.mockReset();
});

describe('native print isolation', () => {
	it('prints from the top window with isolated content then restores the app', async () => {
		const ui = document.createElement('main');
		ui.textContent = 'Editor UI';
		document.body.append(ui);
		await printOnDesktop(
			'<title>Document</title><style>body { color: black; } p { color: red; }</style><body><main class="print-body"><p>Author text</p></main></body>'
		);
		expect(print).toHaveBeenCalledOnce();
		const host = document.getElementById('mdsh-native-print')!;
		expect(host.shadowRoot?.textContent).toContain('Author text');
		expect(host.shadowRoot?.textContent).not.toContain('Editor UI');
		expect(host.shadowRoot?.querySelector('style')?.textContent).toContain(
			':host { color: black; }'
		);
		expect(document.title).toBe('Document');
		window.dispatchEvent(new Event('afterprint'));
		expect(document.getElementById('mdsh-native-print')).toBeNull();
		expect(document.title).toBe('Editor');
		expect(ui.isConnected).toBe(true);
	});
	it('loads only local export styles and resolves their font URLs', async () => {
		const fetch = vi.fn(
			async () =>
				new Response('body { font: 12px Test; } @font-face { src:url(fonts/Test.woff2); }')
		);
		vi.stubGlobal('fetch', fetch);
		await printOnDesktop(
			'<link rel="stylesheet" href="http://localhost:5173/katex/katex.min.css"><body>Math</body>'
		);
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
		await printOnDesktop('<body>First</body>');
		await expect(printOnDesktop('<body>Second</body>')).rejects.toThrow('already active');
		window.dispatchEvent(new Event('afterprint'));
		await printOnDesktop('<body>Second</body>');
		expect(print).toHaveBeenCalledTimes(2);
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
		await printOnDesktop('<body>Text</body>', { signal: active.signal });
		active.abort();
		expect(document.getElementById('mdsh-native-print')).toBeNull();
	});
});
