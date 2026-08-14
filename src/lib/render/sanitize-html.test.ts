import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './markdown';
import {
	sanitizeMermaidPreviewHtml,
	stripRemoteStyleUrls,
	neutralizeRemoteStyleUrls
} from './sanitize-html';
import { sanitizePreviewHtml } from '../milkdown-mermaid-preview';

describe('stripRemoteStyleUrls', () => {
	it('removes https url() beacons and keeps local geometry', () => {
		expect(
			stripRemoteStyleUrls('color:red;background:url(https://tracker.example/px.gif);width:1px')
		).toBe('color:red;background:;width:1px');
	});

	it('removes protocol-relative url()', () => {
		expect(stripRemoteStyleUrls('list-style-image:url(//evil.example/b)')).toBe(
			'list-style-image:'
		);
	});

	it('keeps data: and relative urls', () => {
		const style = 'background:url(data:image/gif;base64,AAA);mask:url(/local.svg)';
		expect(stripRemoteStyleUrls(style)).toBe(style);
	});
});

describe('neutralizeRemoteStyleUrls', () => {
	it('writes the cleaned style back onto the node', () => {
		const attrs: Record<string, string> = {
			style: 'background:url(https://tracker.example/x)'
		};
		const node = {
			hasAttribute: (n: string) => n in attrs,
			getAttribute: (n: string) => attrs[n] ?? null,
			setAttribute: (n: string, v: string) => {
				attrs[n] = v;
			}
		};
		neutralizeRemoteStyleUrls(node);
		expect(attrs.style).not.toMatch(/tracker\.example/);
	});
});

describe('read path vs WYSIWYG Mermaid preview sanitizer', () => {
	const hostile = '<div style="background:url(https://tracker.example/px.gif);color:red">x</div>';

	it('strips remote style url() on the read / export path (renderMarkdown)', async () => {
		const html = await renderMarkdown(hostile);
		expect(html).not.toMatch(/tracker\.example/i);
		expect(html).not.toMatch(/url\(\s*['"]?\s*https?:/i);
	});

	it('strips remote style url() on the shipped WYSIWYG preview sanitizer', async () => {
		const fromModule = await sanitizeMermaidPreviewHtml(hostile);
		const fromPreview = await sanitizePreviewHtml(hostile);
		expect(fromModule).toBe(fromPreview);
		expect(fromPreview).not.toMatch(/tracker\.example/i);
		expect(fromPreview).not.toMatch(/url\(\s*['"]?\s*https?:/i);
		expect(fromPreview).toMatch(/color:\s*red/i);
	});
});
