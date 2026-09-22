import { afterEach, expect, it, vi } from 'vitest';
import { readPreference, writePreference } from './preferences';

afterEach(() => vi.restoreAllMocks());
it('keeps preferences optional when browser storage rejects access', () => {
	vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
		throw new Error('Denied');
	});
	vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
		throw new Error('Denied');
	});
	expect(readPreference('mode')).toBeNull();
	expect(writePreference('mode', 'source')).toBe(false);
});
it('reads, writes, and removes preferences', () => {
	expect(writePreference('test:preference', 'source')).toBe(true);
	expect(readPreference('test:preference')).toBe('source');
	expect(writePreference('test:preference', null)).toBe(true);
	expect(readPreference('test:preference')).toBeNull();
});
