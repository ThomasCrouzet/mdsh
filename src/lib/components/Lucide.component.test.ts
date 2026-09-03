import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import {
	Code2,
	Command,
	Download,
	Eye,
	HardDrive,
	HardDriveDownload,
	Menu,
	Pencil,
	Printer
} from '@lucide/svelte';

describe('compatibilité des composants Lucide utilisés par la barre d’outils', () => {
	it.each([Menu, Download, Eye, Pencil, Code2, Command, HardDrive, HardDriveDownload, Printer])(
		'rend un SVG décoratif avec une géométrie et les dimensions demandées',
		(Icon) => {
			const { container } = render(Icon, { props: { size: 16 } });
			const svg = container.querySelector('svg');
			expect(svg).toHaveAttribute('width', '16');
			expect(svg).toHaveAttribute('height', '16');
			expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
			expect(svg).toHaveAttribute('aria-hidden', 'true');
			expect(svg?.querySelectorAll('path, rect, circle, line, polyline').length).toBeGreaterThan(0);
		}
	);

	it('conserve les props SVG et réagit aux changements de taille et de trait', async () => {
		const { container, rerender } = render(Printer, {
			props: {
				size: 16,
				strokeWidth: 2,
				color: '#123456',
				class: 'export-icon',
				role: 'img',
				'aria-label': 'Impression'
			}
		});
		const svg = container.querySelector('svg');
		expect(svg).toHaveAccessibleName('Impression');
		expect(svg).not.toHaveAttribute('aria-hidden');
		expect(svg).toHaveClass('export-icon');
		expect(svg).toHaveAttribute('stroke', '#123456');
		await rerender({ size: 32, strokeWidth: 3 });
		expect(svg).toHaveAttribute('width', '32');
		expect(svg).toHaveAttribute('height', '32');
		expect(svg).toHaveAttribute('stroke-width', '3');
	});
});
