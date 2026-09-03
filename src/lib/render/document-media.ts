import {
	embedImageFile,
	fetchAndEmbedImage,
	isLocalImageSource,
	MAX_MEDIA_TOTAL_BYTES,
	type MediaIssue
} from './image-media';

export interface MarkdownImageDestination {
	start: number;
	end: number;
	source: string;
}

function escapedAt(source: string, index: number): boolean {
	let slashes = 0;
	for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor--) slashes++;
	return slashes % 2 === 1;
}

/** Finds inline Markdown image destinations while leaving code untouched. */
export function markdownImageDestinations(markdown: string): MarkdownImageDestination[] {
	const destinations: MarkdownImageDestination[] = [];
	let fence: string | null = null;
	let inlineTicks = 0;
	for (let index = 0; index < markdown.length; index++) {
		if (index === 0 || markdown[index - 1] === '\n') {
			const end = markdown.indexOf('\n', index);
			const line = markdown.slice(index, end === -1 ? markdown.length : end);
			const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
			if (match?.[1]) {
				const marker = match[1];
				if (!fence) fence = marker;
				else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
				index = end === -1 ? markdown.length : end;
				continue;
			}
		}
		if (fence) continue;
		if (markdown[index] === '`' && !escapedAt(markdown, index)) {
			let count = 1;
			while (markdown[index + count] === '`') count++;
			if (inlineTicks === 0) inlineTicks = count;
			else if (inlineTicks === count) inlineTicks = 0;
			index += count - 1;
			continue;
		}
		if (inlineTicks === 0 && markdown[index] === '<') {
			const tag = /^<(img|image)\b[^>]*>/i.exec(markdown.slice(index));
			if (tag?.[0]) {
				const attributes = /\b(src|href|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
				for (const attribute of tag[0].matchAll(attributes)) {
					if (tag[1]?.toLowerCase() === 'img' && attribute[1]?.toLowerCase() !== 'src') continue;
					const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? '';
					if (!value) continue;
					const start = index + (attribute.index ?? 0) + attribute[0].lastIndexOf(value);
					const decoder =
						typeof document === 'undefined' ? null : document.createElement('textarea');
					if (decoder) decoder.innerHTML = value;
					destinations.push({ start, end: start + value.length, source: decoder?.value ?? value });
				}
				index += tag[0].length - 1;
				continue;
			}
		}
		if (
			inlineTicks !== 0 ||
			markdown.slice(index, index + 2) !== '![' ||
			escapedAt(markdown, index)
		)
			continue;
		let cursor = index + 2;
		let brackets = 1;
		for (; cursor < markdown.length; cursor++) {
			if (escapedAt(markdown, cursor)) continue;
			if (markdown[cursor] === '[') brackets++;
			if (markdown[cursor] === ']' && --brackets === 0) break;
		}
		if (markdown.slice(cursor, cursor + 2) !== '](') continue;
		cursor += 2;
		while (/\s/.test(markdown[cursor] ?? '') && cursor < markdown.length) cursor++;
		const angle = markdown[cursor] === '<';
		const start = angle ? ++cursor : cursor;
		let parentheses = 0;
		for (; cursor < markdown.length; cursor++) {
			const character = markdown[cursor];
			if (escapedAt(markdown, cursor)) continue;
			if (angle && character === '>') break;
			if (angle) continue;
			if (character === '(') parentheses++;
			if (character === ')') {
				if (parentheses === 0) break;
				parentheses--;
			}
			if (/\s/.test(character ?? '') && parentheses === 0) break;
		}
		if (cursor > start) {
			destinations.push({
				start,
				end: cursor,
				source: markdown.slice(start, cursor).replace(/\\([()])/g, '$1')
			});
			index = cursor;
		}
	}
	return destinations;
}

function normalizedImagePath(value: string): string | null {
	let path = value;
	try {
		if (/^https?:\/\//i.test(path)) path = new URL(path).pathname;
		path = decodeURIComponent(path);
	} catch {
		return null;
	}
	path = path.replace(/\\/g, '/').split(/[?#]/, 1)[0] ?? '';
	if (path.split('/').includes('..')) return null;
	return path.replace(/^\.\//, '').replace(/^\/+/, '');
}

function matchingFile(source: string, files: readonly File[]): File | null {
	const path = normalizedImagePath(source);
	if (!path) return null;
	const basename = path.split('/').pop();
	const exact = files.filter((file) => {
		const selected = normalizedImagePath(file.webkitRelativePath || file.name);
		return selected === path || selected?.endsWith(`/${path}`);
	});
	if (exact.length === 1) return exact[0] ?? null;
	if (exact.length > 1) return null;
	const byName = files.filter((file) => file.name === basename);
	return byName.length === 1 ? (byName[0] ?? null) : null;
}

export async function incorporateDocumentImages(
	markdown: string,
	opts: { files?: readonly File[]; allowNetwork?: boolean }
): Promise<{ markdown: string; embedded: number; issues: MediaIssue[] }> {
	const replacements = new Map<string, string>();
	const issues: MediaIssue[] = [];
	let totalBytes = 0;
	const destinations = markdownImageDestinations(markdown);
	for (const { source } of destinations) {
		const isBlob = /^blob:/i.test(source.trim());
		if (isLocalImageSource(source) && !isBlob) continue;
		if (replacements.has(source)) continue;
		try {
			const file = opts.files ? matchingFile(source, opts.files) : null;
			if (opts.files && !file) {
				issues.push({ source, reason: 'unreadable' });
				continue;
			}
			if (!file && !opts.allowNetwork && !isBlob) {
				issues.push({ source, reason: 'blocked' });
				continue;
			}
			const image = file
				? await embedImageFile(file)
				: await fetchAndEmbedImage(source, MAX_MEDIA_TOTAL_BYTES - totalBytes);
			if (totalBytes + image.bytes > MAX_MEDIA_TOTAL_BYTES) {
				issues.push({ source, reason: 'too-large' });
				continue;
			}
			totalBytes += image.bytes;
			replacements.set(source, image.dataUri);
		} catch {
			issues.push({ source, reason: 'unreadable' });
		}
	}
	let result = markdown;
	for (const destination of destinations.toReversed()) {
		const replacement = replacements.get(destination.source);
		if (replacement)
			result = result.slice(0, destination.start) + replacement + result.slice(destination.end);
	}
	return { markdown: result, embedded: replacements.size, issues };
}
