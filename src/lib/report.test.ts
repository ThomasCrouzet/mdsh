import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { reportError, reportWarning } from './report';
import { notify } from './notify.svelte';

// Section 1.3: Verify the logging sink contract. Always write to the console.
// Show a user toast only when `notifyUser` is present. Keep the requested level.

describe('reportError', () => {
	beforeEach(() => {
		notify.clear();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(() => {
		vi.restoreAllMocks();
		notify.clear();
	});

	it('always logs the prefixed scope to the console', () => {
		const err = new Error('boom');
		reportError('export ZIP', err);
		expect(console.error).toHaveBeenCalledWith('[mdsh] export ZIP :', err);
	});

	it('does not show a toast without notifyUser', () => {
		reportError('chargement IndexedDB', new Error('x'));
		expect(notify.toasts).toHaveLength(0);
	});

	it('shows an error toast when notifyUser is present', () => {
		reportError('export PDF', new Error('x'), { notifyUser: "L'export PDF a échoué." });
		expect(notify.toasts).toHaveLength(1);
		expect(notify.toasts[0]?.level).toBe('error');
		expect(notify.toasts[0]?.message).toBe("L'export PDF a échoué.");
	});

	it('keeps the info level', () => {
		reportError('màj', new Error('x'), { notifyUser: 'Info', level: 'info' });
		expect(notify.toasts[0]?.level).toBe('info');
	});

	it('accepts a thrown value that is not an Error', () => {
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

	it('logs a warning with details', () => {
		reportWarning('front-matter invalide', 'bad indent');
		expect(console.warn).toHaveBeenCalledWith('[mdsh] front-matter invalide :', 'bad indent');
	});

	it('logs a short warning without details', () => {
		reportWarning('quelque chose');
		expect(console.warn).toHaveBeenCalledWith('[mdsh] quelque chose');
	});

	it('never shows a toast', () => {
		reportWarning('discret', 'x');
		expect(notify.toasts).toHaveLength(0);
	});
});
