import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	isQuotaError,
	reportPersistenceError,
	requestPersistentStorage,
	checkStoragePressure
} from './storage';
import { notify } from './notify.svelte';

const originalStorage = Object.getOwnPropertyDescriptor(navigator, 'storage');
function mockStorage(value: unknown): void {
	Object.defineProperty(navigator, 'storage', { value, configurable: true, writable: true });
}

beforeEach(() => {
	notify.clear();
});
afterEach(() => {
	if (originalStorage) Object.defineProperty(navigator, 'storage', originalStorage);
	else mockStorage(undefined);
	vi.restoreAllMocks();
});

describe('isQuotaError', () => {
	it('reconnaît QuotaExceededError', () => {
		expect(isQuotaError(new DOMException('plein', 'QuotaExceededError'))).toBe(true);
	});
	it('reconnaît le nom Firefox historique', () => {
		expect(isQuotaError(new DOMException('plein', 'NS_ERROR_DOM_QUOTA_REACHED'))).toBe(true);
	});
	it('rejette les autres DOMException', () => {
		expect(isQuotaError(new DOMException('annulé', 'AbortError'))).toBe(false);
	});
	it('rejette une Error générique et les non-objets', () => {
		expect(isQuotaError(new Error('quota'))).toBe(false);
		expect(isQuotaError('QuotaExceededError')).toBe(false);
		expect(isQuotaError(null)).toBe(false);
		expect(isQuotaError(undefined)).toBe(false);
	});
});

describe('reportPersistenceError', () => {
	it('émet un toast « stockage plein » actionnable sur quota', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		reportPersistenceError(new DOMException('x', 'QuotaExceededError'), 'save');
		expect(notify.toasts).toHaveLength(1);
		expect(notify.toasts[0]!.level).toBe('error');
		expect(notify.toasts[0]!.message).toContain('Stockage plein');
	});

	it('émet un message « enregistrement » pour une panne save générique', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		reportPersistenceError(new Error('disk fail'), 'save');
		expect(notify.toasts[0]!.message).toContain('enregistrement local');
	});

	it('émet un message générique pour les autres contextes', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		reportPersistenceError(new Error('x'), 'trash');
		expect(notify.toasts[0]!.message).toContain('opération de stockage local');
	});

	it('logge toujours en console pour le diagnostic', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		reportPersistenceError(new Error('boom'), 'reorder');
		expect(spy).toHaveBeenCalledOnce();
	});

	it('déduplique les toasts quota répétés (pas d’avalanche)', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const e = new DOMException('x', 'QuotaExceededError');
		reportPersistenceError(e, 'save');
		reportPersistenceError(e, 'save');
		reportPersistenceError(e, 'save');
		expect(notify.toasts).toHaveLength(1);
	});
});

describe('requestPersistentStorage', () => {
	it('retourne false si l’API est absente', async () => {
		mockStorage(undefined);
		expect(await requestPersistentStorage()).toBe(false);
	});
	it('retourne true sans redemander si déjà persisté', async () => {
		const persist = vi.fn();
		mockStorage({ persisted: async () => true, persist });
		expect(await requestPersistentStorage()).toBe(true);
		expect(persist).not.toHaveBeenCalled();
	});
	it('demande la persistance si pas encore accordée', async () => {
		mockStorage({ persisted: async () => false, persist: async () => true });
		expect(await requestPersistentStorage()).toBe(true);
	});
	it('fail-soft si persist() throw', async () => {
		mockStorage({
			persisted: async () => false,
			persist: async () => {
				throw new Error('nope');
			}
		});
		expect(await requestPersistentStorage()).toBe(false);
	});
});

describe('checkStoragePressure', () => {
	it('no-op si l’API estimate est absente', async () => {
		mockStorage(undefined);
		await checkStoragePressure();
		expect(notify.toasts).toHaveLength(0);
	});
	it('n’alerte pas sous le seuil', async () => {
		mockStorage({ estimate: async () => ({ usage: 10, quota: 100 }) });
		await checkStoragePressure(0.85);
		expect(notify.toasts).toHaveLength(0);
	});
	it('alerte (toast info avec %) au-dessus du seuil', async () => {
		mockStorage({ estimate: async () => ({ usage: 90, quota: 100 }) });
		await checkStoragePressure(0.85);
		expect(notify.toasts).toHaveLength(1);
		expect(notify.toasts[0]!.level).toBe('info');
		expect(notify.toasts[0]!.message).toContain('90');
	});
});
