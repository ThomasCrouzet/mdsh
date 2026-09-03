import { t } from '$lib/i18n';

export function blockEditLabels() {
	return {
		textGroup: {
			label: t('editor.text'),
			text: { label: t('editor.text') },
			h1: { label: t('editor.heading', { n: 1 }) },
			h2: { label: t('editor.heading', { n: 2 }) },
			h3: { label: t('editor.heading', { n: 3 }) },
			h4: { label: t('editor.heading', { n: 4 }) },
			h5: { label: t('editor.heading', { n: 5 }) },
			h6: { label: t('editor.heading', { n: 6 }) },
			quote: { label: t('editor.quote') },
			divider: { label: t('editor.divider') }
		},
		listGroup: {
			label: t('editor.lists'),
			bulletList: { label: t('editor.bulletList') },
			orderedList: { label: t('editor.orderedList') },
			taskList: { label: t('editor.taskList') }
		},
		advancedGroup: {
			label: t('editor.advanced'),
			image: { label: t('editor.image') },
			codeBlock: { label: t('editor.codeBlock') },
			table: { label: t('editor.table') },
			math: { label: t('editor.math') }
		}
	};
}

export function toolbarLabels() {
	return {
		boldLabel: t('editor.bold'),
		italicLabel: t('editor.italic'),
		codeLabel: t('editor.codeBlock'),
		linkLabel: t('editor.link'),
		strikethroughLabel: t('editor.strikethrough'),
		latexLabel: t('editor.math')
	};
}
