import { describe, expect, it } from 'vitest';
import { coreCommands } from './commands';

describe('command registry', () => {
	it('uses unique shortcuts and identifiers', () => {
		expect(new Set(coreCommands.map((command) => command.id)).size).toBe(coreCommands.length);
		expect(new Set(coreCommands.map((command) => command.shortcut)).size).toBe(coreCommands.length);
	});
});
