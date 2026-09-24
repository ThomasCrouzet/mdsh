import { describe, it, expect, vi, afterEach } from 'vitest';
import { createCrossTab, type CrossTabMessage } from './cross-tab';

// jsdom does not implement BroadcastChannel. Use an in-memory polyfill that connects channels by name.
// As with the browser API, the polyfill does not send a message back to its sender.
class FakeBroadcastChannel {
	static channels = new Map<string, Set<FakeBroadcastChannel>>();
	onmessage: ((ev: { data: unknown }) => void) | null = null;
	constructor(public name: string) {
		if (!FakeBroadcastChannel.channels.has(name))
			FakeBroadcastChannel.channels.set(name, new Set());
		FakeBroadcastChannel.channels.get(name)!.add(this);
	}
	postMessage(data: unknown) {
		for (const ch of FakeBroadcastChannel.channels.get(this.name) ?? []) {
			if (ch !== this) queueMicrotask(() => ch.onmessage?.({ data }));
		}
	}
	close() {
		FakeBroadcastChannel.channels.get(this.name)?.delete(this);
	}
}

const tick = () => new Promise((r) => queueMicrotask(() => r(undefined)));

describe('createCrossTab', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		FakeBroadcastChannel.channels.clear();
	});

	it('ignores a message with an unexpected format', async () => {
		vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
		const onB = vi.fn();
		const a = createCrossTab(() => {});
		const b = createCrossTab(onB);
		// Post an invalid raw payload through the underlying channel.
		new FakeBroadcastChannel('mdsh').postMessage('pas-un-message');
		await tick();
		expect(onB).not.toHaveBeenCalled();
		a.close();
		b.close();
	});

	it('keeps the channel active after a handler throws', async () => {
		vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
		const received: CrossTabMessage[] = [];
		let first = true;
		const b = createCrossTab((m) => {
			if (first) {
				first = false;
				throw new Error('handler boom');
			}
			received.push(m);
		});
		const a = createCrossTab(() => {});
		a.post({ type: 'reorder' });
		await tick();
		a.post({ type: 'removed', id: 'z' });
		await tick();
		expect(received).toEqual([{ type: 'removed', id: 'z' }]);
		a.close();
		b.close();
	});
});
