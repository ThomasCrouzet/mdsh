export const splitEn = {
	'splitView.show': 'Show preview',
	'splitView.hide': 'Hide preview',
	'splitView.sourcePane': 'Markdown source',
	'splitView.previewPane': 'Rendered preview',
	'splitView.resize': 'Resize source and preview panes',
	'splitView.resizeValue': 'Source width: {value}%',
	'splitView.renderError': 'Unable to update the preview.'
} as const;

export type SplitMessageKey = keyof typeof splitEn;
