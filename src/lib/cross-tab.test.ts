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

	it('delivers a message to other tabs but not the sender', async () => {
		vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
		const onA = vi.fn();
		const onB = vi.fn();
		const a = createCrossTab(onA);
		const b = createCrossTab(onB);
		const msg: CrossTabMessage = { type: 'draft-written', id: 'x', updatedAt: 1 };
		a.post(msg);
		await tick();
		expect(onB).toHaveBeenCalledWith(msg);
		expect(onA).not.toHaveBeenCalled(); // pas de boucle de rechargement
		a.close();
		b.close();
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

	it('does nothing when BroadcastChannel is unavailable', () => {
		vi.stubGlobal('BroadcastChannel', undefined);
		const ct = createCrossTab(() => {});
		// The operation must not throw when no real channel exists.
		expect(() => ct.post({ type: 'reorder' })).not.toThrow();
		expect(() => ct.close()).not.toThrow();
	});

	it('does not throw when post follows close', async () => {
		vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
		const ct = createCrossTab(() => {});
		ct.close();
		expect(() => ct.post({ type: 'reorder' })).not.toThrow();
	});
});
