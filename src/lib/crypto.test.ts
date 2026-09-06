import { describe, it, expect } from 'vitest';
import { encryptString, decryptString, isEncryptedEnvelope, ENVELOPE_VERSION } from './crypto';

describe('encryptString / decryptString', () => {
	it('decrypts the original text after encryption', async () => {
		const env = await encryptString('mes notes secrètes 🔒', 'hunter2');
		expect(env.alg).toBe('AES-GCM');
		expect(env.v).toBe(ENVELOPE_VERSION);
		const out = await decryptString(env, 'hunter2');
		expect(out).toBe('mes notes secrètes 🔒');
	});

	it('creates a different salt and IV for each encryption', async () => {
		const a = await encryptString('même texte', 'pass');
		const b = await encryptString('même texte', 'pass');
		expect(a.salt).not.toBe(b.salt);
		expect(a.iv).not.toBe(b.iv);
		expect(a.ct).not.toBe(b.ct);
	});

	it('rejects an incorrect passphrase', async () => {
		const env = await encryptString('secret', 'bonne');
		await expect(decryptString(env, 'mauvaise')).rejects.toThrow(/incorrecte|corrompues/);
	});

	it('rejects modified data with GCM authentication', async () => {
		const env = await encryptString('secret', 'pass');
		const tampered = { ...env, ct: env.ct.slice(0, -4) + 'AAAA' };
		await expect(decryptString(tampered, 'pass')).rejects.toThrow();
	});

	it('rejects an empty encryption passphrase', async () => {
		await expect(encryptString('x', '')).rejects.toThrow(/vide/i);
	});

	it('round-trips empty content', async () => {
		const env = await encryptString('', 'p');
		expect(await decryptString(env, 'p')).toBe('');
	});

	it('rejects an excessive `iter` value before key derivation', async () => {
		const env = await encryptString('secret', 'p');
		const hostile = { ...env, iter: 2_000_000_000 };
		await expect(decryptString(hostile, 'p')).rejects.toThrow(/itérations hors limites/);
	});

	it('rejects zero, negative, and fractional `iter` values', async () => {
		const env = await encryptString('secret', 'p');
		await expect(decryptString({ ...env, iter: 0 }, 'p')).rejects.toThrow(/hors limites/);
		await expect(decryptString({ ...env, iter: -5 }, 'p')).rejects.toThrow(/hors limites/);
		await expect(decryptString({ ...env, iter: 1.5 }, 'p')).rejects.toThrow(/hors limites/);
	});

	it('maps invalid base64 fields to an actionable DecryptError', async () => {
		const env = await encryptString('secret', 'p');
		// `atob` throws for invalid base64. Decoding must throw a mapped DecryptError.
		for (const field of ['salt', 'iv', 'ct'] as const) {
			const corrupt = { ...env, [field]: '@@@not-base64@@@' };
			await expect(decryptString(corrupt, 'p')).rejects.toThrow(/encodage corrompu/);
			await expect(decryptString(corrupt, 'p')).rejects.toMatchObject({ name: 'DecryptError' });
		}
	});
});

describe('isEncryptedEnvelope', () => {
	it('recognizes a valid envelope', async () => {
		const env = await encryptString('x', 'p');
		expect(isEncryptedEnvelope(env)).toBe(true);
	});
	it('rejects plain, null, and incomplete objects', () => {
		expect(isEncryptedEnvelope({ format: 'mdsh-backup' })).toBe(false);
		expect(isEncryptedEnvelope(null)).toBe(false);
		expect(isEncryptedEnvelope({ alg: 'AES-GCM' })).toBe(false);
	});
});
