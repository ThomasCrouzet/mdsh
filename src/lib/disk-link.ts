/**
 * Shared disk-link model for browser FSA handles and desktop path links.
 * Pure helpers only - no browser / Tauri I/O.
 */

/** Path-based link used by the Tauri desktop shell. */
export interface PathDiskLink {
	kind: 'path';
	path: string;
}

/** FSA handle link used in Chromium browsers. */
export interface FsaDiskLink {
	kind: 'fsa';
	handle: FileSystemFileHandle;
}

export type DiskLink = PathDiskLink | FsaDiskLink;

/** Shape persisted in IDB for path links (structured cloneable). */
export interface PathLinkRecord {
	kind: 'path';
	path: string;
}

/**
 * True when a value stored in `mdsh-fs` is a path link record (desktop).
 * FSA stores a raw `FileSystemFileHandle`, which has no `kind: 'path'`.
 */
export function isPathLinkRecord(value: unknown): value is PathLinkRecord {
	if (typeof value !== 'object' || value === null) return false;
	const rec = value as Record<string, unknown>;
	return rec.kind === 'path' && typeof rec.path === 'string' && rec.path.length > 0;
}

/** Last path segment of a POSIX or Windows path (for display names). */
export function pathBasename(path: string): string {
	const norm = path.replace(/\\/g, '/');
	const trimmed = norm.endsWith('/') && norm.length > 1 ? norm.slice(0, -1) : norm;
	const i = trimmed.lastIndexOf('/');
	return i >= 0 ? trimmed.slice(i + 1) : trimmed;
}

/** Extensions accepted for disk open/save and argv file association. */
export const DISK_MD_EXTENSIONS = ['.md', '.markdown', '.mdx', '.txt'] as const;

export function isMarkdownDiskPath(path: string): boolean {
	const base = pathBasename(path).toLowerCase();
	return DISK_MD_EXTENSIONS.some((ext) => base.endsWith(ext));
}

export function pathLinkRecord(path: string): PathLinkRecord {
	return { kind: 'path', path };
}
