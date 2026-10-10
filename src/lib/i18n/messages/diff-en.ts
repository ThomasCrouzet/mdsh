export const diffEn = {
	'diff.added': 'Added line {line}',
	'diff.after': 'After',
	'diff.approximate': 'Large comparison. Counts are approximate.',
	'diff.before': 'Before',
	'diff.lineTruncated': 'Line {line} is shortened in this view.',
	'diff.noChanges': 'No line changes.',
	'diff.omitted': '{old} old line(s) and {next} new line(s) omitted',
	'diff.removed': 'Removed line {line}',
	'diff.summary': '{added} added and {removed} removed line(s).',
	'diff.unchanged': 'Unchanged line {line}',
	'diskConflict.cancel': 'Cancel',
	'diskConflict.description':
		'This file changed on disk. Compare both revisions before you choose which content to keep.',
	'diskConflict.disk': 'Disk revision',
	'diskConflict.local': 'Local revision',
	'diskConflict.overwrite': 'Overwrite disk',
	'diskConflict.reload': 'Use disk revision',
	'diskConflict.title': 'Resolve disk conflict for {name}',
	'replacePreview.cancel': 'Back to search',
	'replacePreview.confirm': 'Confirm replacement',
	'replacePreview.description': 'Review each changed file. No document changes until you confirm.',
	'replacePreview.fileCount': '{files} file(s), {occurrences} replacement(s)',
	'replacePreview.next': 'Next file',
	'replacePreview.previous': 'Previous file',
	'replacePreview.stale': 'A previewed file changed. Create a new preview before replacement.',
	'replacePreview.title': 'Replacement preview'
} as const;

export type DiffMessageKey = keyof typeof diffEn;
