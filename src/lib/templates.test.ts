import { describe, it, expect } from 'vitest';
import { BUILTIN_TEMPLATES, applyTemplateVars, isoDate, templateFileName } from './templates';

const FIXED = new Date('2026-06-16T10:30:00.000Z');

describe('isoDate', () => {
	it('formate en YYYY-MM-DD', () => {
		expect(isoDate(FIXED)).toBe('2026-06-16');
	});
});

describe('applyTemplateVars', () => {
	it('replaces {{date}} with the current date', () => {
		expect(applyTemplateVars('Aujourd’hui : {{date}}', FIXED)).toBe('Aujourd’hui : 2026-06-16');
	});

	it('replaces all occurrences', () => {
		expect(applyTemplateVars('{{date}} / {{date}}', FIXED)).toBe('2026-06-16 / 2026-06-16');
	});

	it('keeps content unchanged when it has no variable', () => {
		expect(applyTemplateVars('# Titre', FIXED)).toBe('# Titre');
	});
});

describe('BUILTIN_TEMPLATES', () => {
	it('have stable IDs with the builtin prefix', () => {
		for (const t of BUILTIN_TEMPLATES) {
			expect(t.id).toMatch(/^builtin:/);
			expect(t.name.length).toBeGreaterThan(0);
			expect(t.content.length).toBeGreaterThan(0);
		}
	});

	it('include the date variable in journal and meeting templates', () => {
		const journal = BUILTIN_TEMPLATES.find((t) => t.id === 'builtin:journal');
		const meeting = BUILTIN_TEMPLATES.find((t) => t.id === 'builtin:meeting');
		expect(journal?.content).toContain('{{date}}');
		expect(meeting?.content).toContain('{{date}}');
	});

	it('replace all variables', () => {
		for (const t of BUILTIN_TEMPLATES) {
			expect(applyTemplateVars(t.content, FIXED)).not.toContain('{{date}}');
		}
	});
});

describe('templateFileName', () => {
	it('uses the date as the journal name', () => {
		expect(templateFileName({ id: 'builtin:journal', name: 'Journal' }, FIXED)).toBe(
			'2026-06-16.md'
		);
	});

	it('prefixes a meeting with Meeting and its date', () => {
		expect(templateFileName({ id: 'builtin:meeting', name: 'Note' }, FIXED)).toBe(
			'Meeting 2026-06-16.md'
		);
	});

	it('uses the template name for other templates', () => {
		expect(templateFileName({ id: 'builtin:todo', name: 'To do' }, FIXED)).toBe('To do.md');
	});
});
