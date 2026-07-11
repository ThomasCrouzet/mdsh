// §2.7 - Pure document-template logic (no rune, testable).
//
// The "builtin" templates live in code (never persisted in the database): they
// are therefore always present, do not pollute backups (§1.1 only exports the
// user templates from `db.templates`), and cannot be corrupted.
// User templates, by contrast, are persisted in `db.templates`.

export interface TemplateDef {
	id: string;
	name: string;
	description: string;
	/** Markdown body, with `{{date}}` variables substituted at instantiation. */
	content: string;
}

/** Provided templates. Stable id `builtin:<slug>` (not persisted, cf. header). */
export const BUILTIN_TEMPLATES: TemplateDef[] = [
	{
		id: 'builtin:meeting',
		name: 'Meeting note',
		description: 'Agenda, decisions, actions',
		content: `---
title: Meeting {{date}}
tags: [meeting]
---

# Meeting - {{date}}

**Attendees:**

## Agenda

-

## Decisions

-

## Actions

- [ ]
`
	},
	{
		id: 'builtin:journal',
		name: 'Daily journal',
		description: 'Dated entry for the day',
		content: `---
title: {{date}}
tags: [journal]
---

# {{date}}

## Notes

`
	},
	{
		id: 'builtin:todo',
		name: 'To-do list',
		description: 'Simple checklist',
		content: `# To do

- [ ]
- [ ]
- [ ]
`
	}
];

/** Today's date in short ISO format (YYYY-MM-DD), sortable and neutral. */
export function isoDate(now: Date = new Date()): string {
	return now.toISOString().slice(0, 10);
}

/**
 * Substitutes the template variables. Today: `{{date}}` → today's date.
 * Designed to be extended (time, title…) without breaking existing templates.
 */
export function applyTemplateVars(content: string, now: Date = new Date()): string {
	return content.split('{{date}}').join(isoDate(now));
}

/**
 * Suggested filename for a new document created from a template.
 * Dated templates (meeting, journal) include the date; the others take their
 * template name.
 */
export function templateFileName(
	def: { id: string; name: string },
	now: Date = new Date()
): string {
	const date = isoDate(now);
	if (def.id === 'builtin:journal') return `${date}.md`;
	if (def.id === 'builtin:meeting') return `Meeting ${date}.md`;
	return `${def.name}.md`;
}
