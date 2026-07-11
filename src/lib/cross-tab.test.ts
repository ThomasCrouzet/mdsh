import { describe, it, expect, vi, afterEach } from 'vitest';
import { createCrossTab, type CrossTabMessage } from './cross-tab';

// jsdom n'implémente pas BroadcastChannel → polyfill en mémoire qui relie les
// instances par nom de canal (et ne renvoie jamais à l'émetteur, comme le vrai).
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

	it('délivre un message aux AUTRES onglets, jamais à l’émetteur', async () => {
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

	it('ignore un message au format inattendu (pas d’objet typé)', async () => {
		vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
		const onB = vi.fn();
		const a = createCrossTab(() => {});
		const b = createCrossTab(onB);
		// On poste un payload brut non conforme directement via le canal sous-jacent.
		new FakeBroadcastChannel('mdsh').postMessage('pas-un-message');
		await tick();
		expect(onB).not.toHaveBeenCalled();
		a.close();
		b.close();
	});

	it('un handler qui throw ne casse pas le canal (message suivant délivré)', async () => {
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

	it('no-op silencieux si BroadcastChannel est indisponible', () => {
		vi.stubGlobal('BroadcastChannel', undefined);
		const ct = createCrossTab(() => {});
		// Aucune exception, même sans canal réel.
		expect(() => ct.post({ type: 'reorder' })).not.toThrow();
		expect(() => ct.close()).not.toThrow();
	});

	it('post après close ne throw pas', async () => {
		vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
		const ct = createCrossTab(() => {});
		ct.close();
		expect(() => ct.post({ type: 'reorder' })).not.toThrow();
	});
});
