import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	isQuotaError,
	reportPersistenceError,
	requestPersistentStorage,
	checkStoragePressure,
	getStorageHealth,
	recordExternalBackupFailure,
	recordExternalBackupSuccess,
	recordBackupReminderShown,
	isBackupReminderDue,
	formatStorageBytes
} from './storage';
import { notify } from './notify.svelte';

const originalStorage = Object.getOwnPropertyDescriptor(navigator, 'storage');
function mockStorage(value: unknown): void {
	Object.defineProperty(navigator, 'storage', { value, configurable: true, writable: true });
}

beforeEach(() => {
	notify.clear();
	localStorage.clear();
});
afterEach(() => {
	if (originalStorage) Object.defineProperty(navigator, 'storage', originalStorage);
	else mockStorage(undefined);
	vi.restoreAllMocks();
});

describe('isQuotaError', () => {
	it('recognizes QuotaExceededError', () => {
		expect(isQuotaError(new DOMException('plein', 'QuotaExceededError'))).toBe(true);
	});
	it('recognizes the legacy Firefox name', () => {
		expect(isQuotaError(new DOMException('plein', 'NS_ERROR_DOM_QUOTA_REACHED'))).toBe(true);
	});
	it('rejects other DOMException values', () => {
		expect(isQuotaError(new DOMException('annulé', 'AbortError'))).toBe(false);
	});
	it('rejects a generic Error and non-object values', () => {
		expect(isQuotaError(new Error('quota'))).toBe(false);
		expect(isQuotaError('QuotaExceededError')).toBe(false);
		expect(isQuotaError(null)).toBe(false);
		expect(isQuotaError(undefined)).toBe(false);
	});
});

describe('reportPersistenceError', () => {
	it('shows an actionable full-storage toast for a quota error', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		reportPersistenceError(new DOMException('x', 'QuotaExceededError'), 'save');
		expect(notify.toasts).toHaveLength(1);
		expect(notify.toasts[0]!.level).toBe('error');
		expect(notify.toasts[0]!.message).toContain('Stockage plein');
	});

	it('shows a save message for a generic save failure', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		reportPersistenceError(new Error('disk fail'), 'save');
		expect(notify.toasts[0]!.message).toContain('enregistrement local');
	});

	it('shows a generic message for other contexts', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		reportPersistenceError(new Error('x'), 'trash');
		expect(notify.toasts[0]!.message).toContain('opération de stockage local');
	});

	it('always logs diagnostics to the console', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		reportPersistenceError(new Error('boom'), 'reorder');
		expect(spy).toHaveBeenCalledOnce();
	});

	it('deduplicates repeated quota toasts', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const e = new DOMException('x', 'QuotaExceededError');
		reportPersistenceError(e, 'save');
		reportPersistenceError(e, 'save');
		reportPersistenceError(e, 'save');
		expect(notify.toasts).toHaveLength(1);
	});
});

describe('requestPersistentStorage', () => {
	it('returns false when the API is absent', async () => {
		mockStorage(undefined);
		expect(await requestPersistentStorage()).toBe(false);
	});
	it('returns true without a new request when storage is persistent', async () => {
		const persist = vi.fn();
		mockStorage({ persisted: async () => true, persist });
		expect(await requestPersistentStorage()).toBe(true);
		expect(persist).not.toHaveBeenCalled();
	});
	it('requests persistence when it is not granted', async () => {
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
	it('does nothing when the estimate API is absent', async () => {
		mockStorage(undefined);
		await checkStoragePressure();
		expect(notify.toasts).toHaveLength(0);
	});
	it('does not alert below the threshold', async () => {
		mockStorage({ estimate: async () => ({ usage: 10, quota: 100 }) });
		await checkStoragePressure(0.85);
		expect(notify.toasts).toHaveLength(0);
	});
	it('shows an informational toast with the percentage above the threshold', async () => {
		mockStorage({ estimate: async () => ({ usage: 90, quota: 100 }) });
		await checkStoragePressure(0.85);
		expect(notify.toasts).toHaveLength(1);
		expect(notify.toasts[0]!.level).toBe('info');
		expect(notify.toasts[0]!.message).toContain('90');
	});
});

describe('storage health', () => {
	it('reports persistent status, usage and quota', async () => {
		mockStorage({
			persisted: async () => true,
			estimate: async () => ({ usage: 12_000, quota: 100_000 })
		});
		await expect(getStorageHealth(100)).resolves.toMatchObject({
			persistence: 'persistent',
			usage: 12_000,
			quota: 100_000
		});
	});

	it('keeps successful backup and failure timestamps locally', async () => {
		recordExternalBackupFailure(100);
		let health = await getStorageHealth(200);
		expect(health.lastBackupErrorAt).toBe(100);
		recordExternalBackupSuccess(300);
		health = await getStorageHealth(400);
		expect(health.lastExternalBackupAt).toBe(300);
		expect(health.lastBackupErrorAt).toBeNull();
	});

	it('bounds backup reminders to once per week and after thirty days', () => {
		const day = 24 * 60 * 60 * 1000;
		expect(isBackupReminderDue(40 * day, 0, null)).toBe(true);
		expect(isBackupReminderDue(40 * day, 20 * day, null)).toBe(false);
		expect(isBackupReminderDue(40 * day, null, 38 * day)).toBe(false);
		recordBackupReminderShown(40 * day);
		expect(localStorage.getItem('mdsh:storage:last-backup-reminder')).toBe(String(40 * day));
	});

	it('formats storage sizes without locale-dependent output', () => {
		expect(formatStorageBytes(900)).toBe('900 B');
		expect(formatStorageBytes(1536)).toBe('1.5 KiB');
		expect(formatStorageBytes(12 * 1024 * 1024)).toBe('12 MiB');
	});

	it('falls back safely when persistence metadata APIs fail', async () => {
		mockStorage({
			persisted: async () => {
				throw new Error('blocked');
			},
			estimate: async () => ({})
		});
		await expect(getStorageHealth()).resolves.toMatchObject({
			persistence: 'best-effort',
			usage: null,
			quota: null
		});
	});

	it('treats inaccessible local health metadata as unavailable', async () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		const health = await getStorageHealth();
		expect(health.lastExternalBackupAt).toBeNull();
		expect(health.lastBackupErrorAt).toBeNull();
	});

	it('ignores unavailable quota values and estimate failures', async () => {
		mockStorage({ estimate: async () => ({ usage: 0, quota: 100 }) });
		await checkStoragePressure();
		expect(notify.toasts).toHaveLength(0);
		mockStorage({
			estimate: async () => {
				throw new Error('blocked');
			}
		});
		await expect(checkStoragePressure()).resolves.toBeUndefined();
	});
});
