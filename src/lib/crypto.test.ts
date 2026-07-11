import { describe, it, expect } from 'vitest';
import { encryptString, decryptString, isEncryptedEnvelope, ENVELOPE_VERSION } from './crypto';

describe('encryptString / decryptString', () => {
	it('round-trip : déchiffre le texte original', async () => {
		const env = await encryptString('mes notes secrètes 🔒', 'hunter2');
		expect(env.alg).toBe('AES-GCM');
		expect(env.v).toBe(ENVELOPE_VERSION);
		const out = await decryptString(env, 'hunter2');
		expect(out).toBe('mes notes secrètes 🔒');
	});

	it('chaque chiffrement produit un sel + IV différents (non déterministe)', async () => {
		const a = await encryptString('même texte', 'pass');
		const b = await encryptString('même texte', 'pass');
		expect(a.salt).not.toBe(b.salt);
		expect(a.iv).not.toBe(b.iv);
		expect(a.ct).not.toBe(b.ct);
	});

	it('mauvaise passphrase → erreur', async () => {
		const env = await encryptString('secret', 'bonne');
		await expect(decryptString(env, 'mauvaise')).rejects.toThrow(/incorrecte|corrompues/);
	});

	it('données altérées → erreur (authentification GCM)', async () => {
		const env = await encryptString('secret', 'pass');
		const tampered = { ...env, ct: env.ct.slice(0, -4) + 'AAAA' };
		await expect(decryptString(tampered, 'pass')).rejects.toThrow();
	});

	it('passphrase vide refusée au chiffrement', async () => {
		await expect(encryptString('x', '')).rejects.toThrow(/vide/i);
	});

	it('round-trip sur contenu vide', async () => {
		const env = await encryptString('', 'p');
		expect(await decryptString(env, 'p')).toBe('');
	});

	it('rejette une enveloppe avec `iter` démesuré (borne anti-DoS) sans dériver de clé', async () => {
		const env = await encryptString('secret', 'p');
		const hostile = { ...env, iter: 2_000_000_000 };
		await expect(decryptString(hostile, 'p')).rejects.toThrow(/itérations hors limites/);
	});

	it('rejette un `iter` invalide (0, négatif, non entier)', async () => {
		const env = await encryptString('secret', 'p');
		await expect(decryptString({ ...env, iter: 0 }, 'p')).rejects.toThrow(/hors limites/);
		await expect(decryptString({ ...env, iter: -5 }, 'p')).rejects.toThrow(/hors limites/);
		await expect(decryptString({ ...env, iter: 1.5 }, 'p')).rejects.toThrow(/hors limites/);
	});

	it('mappe un base64 corrompu (salt/iv/ct) sur DecryptError actionnable', async () => {
		const env = await encryptString('secret', 'p');
		// `atob` jette sur un base64 malformé : le décodage doit lever DecryptError
		// (message « encodage corrompu »), pas une erreur générique non mappée.
		for (const field of ['salt', 'iv', 'ct'] as const) {
			const corrupt = { ...env, [field]: '@@@not-base64@@@' };
			await expect(decryptString(corrupt, 'p')).rejects.toThrow(/encodage corrompu/);
			await expect(decryptString(corrupt, 'p')).rejects.toMatchObject({ name: 'DecryptError' });
		}
	});
});

describe('isEncryptedEnvelope', () => {
	it('reconnaît une enveloppe valide', async () => {
		const env = await encryptString('x', 'p');
		expect(isEncryptedEnvelope(env)).toBe(true);
	});
	it('rejette un objet clair / null / partiel', () => {
		expect(isEncryptedEnvelope({ format: 'mdsh-backup' })).toBe(false);
		expect(isEncryptedEnvelope(null)).toBe(false);
		expect(isEncryptedEnvelope({ alg: 'AES-GCM' })).toBe(false);
	});
});
