import { describe, expect, it } from 'vitest';
import { coreCommands, normalizeCommandSearch } from './commands';

describe('command registry', () => {
	it('normalizes accents and case for search', () => {
		expect(normalizeCommandSearch('RÉGLAGES')).toBe('reglages');
		expect(normalizeCommandSearch('Paramètres')).toBe('parametres');
	});
	it('uses unique shortcuts and identifiers', () => {
		expect(new Set(coreCommands.map((command) => command.id)).size).toBe(coreCommands.length);
		expect(new Set(coreCommands.map((command) => command.shortcut)).size).toBe(coreCommands.length);
	});
});
