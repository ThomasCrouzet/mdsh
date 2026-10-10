export const projectEn = {
	'projects.title': 'Markdown projects',
	'projects.open': 'Projects',
	'projects.close': 'Close projects',
	'projects.create': 'New project',
	'projects.name': 'Project name',
	'projects.importZip': 'Import project ZIP',
	'projects.importFolder': 'Import folder',
	'projects.export': 'Export project',
	'projects.checkLinks': 'Check links',
	'projects.noIssues': 'All local links resolve.',
	'projects.newDocument': 'New project document',
	'projects.documentPath': 'Document path, for example notes/guide.md',
	'projects.openDocument': 'Open {path}',
	'projects.empty': 'Create a project or import a folder or ZIP archive.',
	'projects.local':
		'Documents and assets stay on this device. Export a ZIP to keep a separate copy.',
	'projects.operationFailed':
		'The project operation failed. Check the paths, file formats, and size limits, then try again.',
	'projects.limits': 'Up to 300 documents, 64 MB per project, and 2 MB per image.',
	'projects.linkMissing': 'The linked document is missing from this project.',
	'projects.busy': 'Processing project...',
	'projects.missing': 'Missing resource',
	'projects.ambiguous': 'Ambiguous wiki link',
	'projects.outside-project': 'Path outside the project',
	'projects.remote': 'Remote image requires consent',
	'projects.nativeOpen': 'Open a disk folder',
	'projects.refresh': 'Refresh from disk',
	'projects.save': 'Save project to disk',
	'projects.unlink': 'Disconnect disk folder',
	'projects.saved': 'Project saved to disk.',
	'projects.refreshed': 'Project refreshed from disk.'
} as const;

export type ProjectMessageKey = keyof typeof projectEn;
