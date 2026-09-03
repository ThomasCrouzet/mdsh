import { describe, expect, it } from 'vitest';
import { coreCommands, normalizeCommandSearch } from './commands';

describe('registre de commandes', () => {
	it('normalise accents et casse pour la recherche', () => {
		expect(normalizeCommandSearch('RÉGLAGES')).toBe('reglages');
		expect(normalizeCommandSearch('Paramètres')).toBe('parametres');
	});
	it('chaque raccourci et chaque identifiant sont uniques', () => {
		expect(new Set(coreCommands.map((command) => command.id)).size).toBe(coreCommands.length);
		expect(new Set(coreCommands.map((command) => command.shortcut)).size).toBe(coreCommands.length);
	});
});
