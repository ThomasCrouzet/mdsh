import { describe, it, expect } from 'vitest';
import { BUILTIN_TEMPLATES, applyTemplateVars, isoDate, templateFileName } from './templates';

const FIXED = new Date('2026-06-16T10:30:00.000Z');

describe('isoDate', () => {
	it('formate en YYYY-MM-DD', () => {
		expect(isoDate(FIXED)).toBe('2026-06-16');
	});
});

describe('applyTemplateVars', () => {
	it('substitue {{date}} par la date du jour', () => {
		expect(applyTemplateVars('Aujourd’hui : {{date}}', FIXED)).toBe('Aujourd’hui : 2026-06-16');
	});

	it('substitue toutes les occurrences', () => {
		expect(applyTemplateVars('{{date}} / {{date}}', FIXED)).toBe('2026-06-16 / 2026-06-16');
	});

	it('laisse le contenu intact sans variable', () => {
		expect(applyTemplateVars('# Titre', FIXED)).toBe('# Titre');
	});
});

describe('BUILTIN_TEMPLATES', () => {
	it('ont des ids stables préfixés builtin:', () => {
		for (const t of BUILTIN_TEMPLATES) {
			expect(t.id).toMatch(/^builtin:/);
			expect(t.name.length).toBeGreaterThan(0);
			expect(t.content.length).toBeGreaterThan(0);
		}
	});

	it('le journal et la réunion contiennent la variable {{date}}', () => {
		const journal = BUILTIN_TEMPLATES.find((t) => t.id === 'builtin:journal');
		const meeting = BUILTIN_TEMPLATES.find((t) => t.id === 'builtin:meeting');
		expect(journal?.content).toContain('{{date}}');
		expect(meeting?.content).toContain('{{date}}');
	});

	it('après substitution, plus aucune variable ne subsiste', () => {
		for (const t of BUILTIN_TEMPLATES) {
			expect(applyTemplateVars(t.content, FIXED)).not.toContain('{{date}}');
		}
	});
});

describe('templateFileName', () => {
	it('le journal prend la date comme nom', () => {
		expect(templateFileName({ id: 'builtin:journal', name: 'Journal' }, FIXED)).toBe(
			'2026-06-16.md'
		);
	});

	it('la réunion préfixe par « Meeting » + date', () => {
		expect(templateFileName({ id: 'builtin:meeting', name: 'Note' }, FIXED)).toBe(
			'Meeting 2026-06-16.md'
		);
	});

	it('les autres modèles prennent leur nom', () => {
		expect(templateFileName({ id: 'builtin:todo', name: 'To do' }, FIXED)).toBe('To do.md');
	});
});
