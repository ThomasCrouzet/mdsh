import { describe, it, expect } from 'vitest';
import { applyTemplateVars, isoDate } from './templates';

const FIXED = new Date('2026-06-16T10:30:00.000Z');

describe('isoDate', () => {
	it('uses the local calendar date near midnight', () => {
		expect(isoDate(new Date(2026, 8, 22, 0, 15))).toBe('2026-09-22');
	});
});

describe('applyTemplateVars', () => {
	it('replaces all occurrences', () => {
		expect(applyTemplateVars('{{date}} / {{date}}', FIXED)).toBe('2026-06-16 / 2026-06-16');
	});
});
