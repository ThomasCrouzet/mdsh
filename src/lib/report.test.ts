import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { reportError, reportWarning } from './report';
import { notify } from './notify.svelte';

// §1.3 - Garantit le contrat du sink de journalisation : console TOUJOURS,
// toast utilisateur UNIQUEMENT si `notifyUser` est fourni, niveau respecté.

describe('reportError', () => {
	beforeEach(() => {
		notify.clear();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(() => {
		vi.restoreAllMocks();
		notify.clear();
	});

	it('journalise toujours en console avec le scope préfixé', () => {
		const err = new Error('boom');
		reportError('export ZIP', err);
		expect(console.error).toHaveBeenCalledWith('[mdsh] export ZIP :', err);
	});

	it('ne dépose aucun toast sans notifyUser', () => {
		reportError('chargement IndexedDB', new Error('x'));
		expect(notify.toasts).toHaveLength(0);
	});

	it('dépose un toast erreur quand notifyUser est fourni', () => {
		reportError('export PDF', new Error('x'), { notifyUser: "L'export PDF a échoué." });
		expect(notify.toasts).toHaveLength(1);
		expect(notify.toasts[0]?.level).toBe('error');
		expect(notify.toasts[0]?.message).toBe("L'export PDF a échoué.");
	});

	it('respecte le niveau info', () => {
		reportError('màj', new Error('x'), { notifyUser: 'Info', level: 'info' });
		expect(notify.toasts[0]?.level).toBe('info');
	});

	it('accepte une valeur thrown non-Error', () => {
		reportError('scope', 'just a string');
		expect(console.error).toHaveBeenCalledWith('[mdsh] scope :', 'just a string');
	});
});

describe('reportWarning', () => {
	beforeEach(() => {
		notify.clear();
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});
	afterEach(() => {
		vi.restoreAllMocks();
		notify.clear();
	});

	it('journalise un warning avec détail', () => {
		reportWarning('front-matter invalide', 'bad indent');
		expect(console.warn).toHaveBeenCalledWith('[mdsh] front-matter invalide :', 'bad indent');
	});

	it('journalise un warning sans détail (forme courte)', () => {
		reportWarning('quelque chose');
		expect(console.warn).toHaveBeenCalledWith('[mdsh] quelque chose');
	});

	it('ne dépose jamais de toast', () => {
		reportWarning('discret', 'x');
		expect(notify.toasts).toHaveLength(0);
	});
});
