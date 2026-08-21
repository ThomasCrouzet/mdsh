/**
 * Opaque-capability disk I/O for the Tauri desktop shell.
 *
 * Native Rust dialogs are the only source of capabilities. The webview sees a
 * display path but can invoke read, stat and write operations only with the
 * unguessable token returned by Rust for the current process session.
 */

import { pathBasename, isMarkdownDiskPath, type PathLinkRecord, pathLinkRecord } from './disk-link';

export interface DiskFileMeta {
	lastModified: number;
	size: number;
	revision: string;
}

export interface NativeDiskGrant {
	token: string;
	path: string;
	stat: DiskFileMeta | null;
}

export interface TauriDiskIo {
	openGrants(multiple: boolean): Promise<NativeDiskGrant[]>;
	saveGrant(suggestedName: string): Promise<NativeDiskGrant | null>;
	saveExportGrant(suggestedName: string): Promise<NativeDiskGrant | null>;
	readText(token: string): Promise<string>;
	writeText(
		token: string,
		content: string,
		expectedRevision: string | null,
		force: boolean
	): Promise<DiskFileMeta>;
	writeBytes(
		token: string,
		contents: Uint8Array,
		expectedRevision: string | null,
		force: boolean
	): Promise<DiskFileMeta>;
	stat(token: string): Promise<DiskFileMeta | null>;
}

export interface OpenedDiskFile {
	name: string;
	content: string;
	path: string;
	lastModified: number;
	size: number;
	revision: string;
	link: PathLinkRecord;
}

export interface OpenedDiskFiles {
	files: OpenedDiskFile[];
	failed: number;
}

let io: TauriDiskIo | null = null;
let ioPromise: Promise<TauriDiskIo> | null = null;
const grantsByPath = new Map<string, NativeDiskGrant>();

function registerGrants(grants: NativeDiskGrant[]): void {
	for (const grant of grants) {
		if (grant.token && isMarkdownDiskPath(grant.path)) grantsByPath.set(grant.path, grant);
		else if (grant.token) grantsByPath.set(grant.path, grant);
	}
}

function grantForPath(path: string): NativeDiskGrant {
	const grant = grantsByPath.get(path);
	if (!grant) throw new Error('Disk capability expired. Choose the file again.');
	return grant;
}

export function setTauriDiskIoForTests(value: TauriDiskIo | null): void {
	io = value;
	ioPromise = value ? Promise.resolve(value) : null;
	grantsByPath.clear();
}

export async function createTauriDiskIo(): Promise<TauriDiskIo> {
	const { invoke } = await import('@tauri-apps/api/core');
	const toMeta = (stat: { mtimeMs: number; size: number; revision: string }): DiskFileMeta => ({
		lastModified: stat.mtimeMs,
		size: stat.size,
		revision: stat.revision
	});
	const toGrant = (grant: {
		token: string;
		path: string;
		stat: { mtimeMs: number; size: number; revision: string } | null;
	}): NativeDiskGrant => ({
		token: grant.token,
		path: grant.path,
		stat: grant.stat ? toMeta(grant.stat) : null
	});

	return {
		async openGrants(multiple) {
			const grants = await invoke<
				Array<{
					token: string;
					path: string;
					stat: { mtimeMs: number; size: number; revision: string } | null;
				}>
			>('disk_open_dialog', { multiple });
			return grants.map(toGrant);
		},
		async saveGrant(suggestedName) {
			const grant = await invoke<{
				token: string;
				path: string;
				stat: { mtimeMs: number; size: number; revision: string } | null;
			} | null>('disk_save_dialog', { suggestedName, export: false });
			return grant ? toGrant(grant) : null;
		},
		async saveExportGrant(suggestedName) {
			const grant = await invoke<{
				token: string;
				path: string;
				stat: { mtimeMs: number; size: number; revision: string } | null;
			} | null>('disk_save_dialog', { suggestedName, export: true });
			return grant ? toGrant(grant) : null;
		},
		readText(token) {
			return invoke<string>('disk_read', { token });
		},
		async writeText(token, content, expectedRevision, force) {
			const stat = await invoke<{ mtimeMs: number; size: number; revision: string }>('disk_write', {
				token,
				content,
				expectedRevision,
				force
			});
			return toMeta(stat);
		},
		async writeBytes(token, contents, expectedRevision, force) {
			const stat = await invoke<{ mtimeMs: number; size: number; revision: string }>(
				'disk_write_bytes',
				{ token, contents: Array.from(contents), expectedRevision, force }
			);
			return toMeta(stat);
		},
		async stat(token) {
			const stat = await invoke<{ mtimeMs: number; size: number; revision: string } | null>(
				'disk_stat',
				{ token }
			);
			return stat ? toMeta(stat) : null;
		}
	};
}

async function getIo(): Promise<TauriDiskIo> {
	if (io) return io;
	if (!ioPromise) {
		ioPromise = createTauriDiskIo().then((created) => {
			io = created;
			return created;
		});
	}
	return ioPromise;
}

export async function tauriPickAndOpen(): Promise<OpenedDiskFiles> {
	const currentIo = await getIo();
	const grants = await currentIo.openGrants(true);
	registerGrants(grants);
	return openGrants(grants, currentIo);
}

export async function tauriPickSaveTarget(suggestedName: string): Promise<PathLinkRecord | null> {
	const currentIo = await getIo();
	const grant = await currentIo.saveGrant(suggestedName);
	if (!grant) return null;
	registerGrants([grant]);
	return pathLinkRecord(grant.path);
}

export async function tauriWritePath(
	path: string,
	content: string,
	expectedRevision: string | null,
	force = false
): Promise<DiskFileMeta> {
	const currentIo = await getIo();
	const grant = grantForPath(path);
	const stat = await currentIo.writeText(grant.token, content, expectedRevision, force);
	grant.stat = stat;
	return stat;
}

async function readBlobBytes(blob: Blob): Promise<Uint8Array> {
	if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
		reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
		reader.readAsArrayBuffer(blob);
	});
}

export async function tauriSaveExportBlob(blob: Blob, suggestedName: string): Promise<boolean> {
	const currentIo = await getIo();
	const grant = await currentIo.saveExportGrant(suggestedName);
	if (!grant) return false;
	registerGrants([grant]);
	const bytes = await readBlobBytes(blob);
	const expectedRevision = grant.stat?.revision ?? null;
	if (/\.(md|markdown|mdx|txt|html|htm|json)$/i.test(grant.path)) {
		grant.stat = await currentIo.writeText(
			grant.token,
			new TextDecoder('utf-8').decode(bytes),
			expectedRevision,
			false
		);
	} else {
		grant.stat = await currentIo.writeBytes(grant.token, bytes, expectedRevision, false);
	}
	return true;
}

export async function tauriReadMeta(path: string): Promise<DiskFileMeta | null> {
	const currentIo = await getIo();
	return currentIo.stat(grantForPath(path).token);
}

export async function tauriCheckPath(path: string): Promise<'ok' | 'broken' | 'permission-needed'> {
	try {
		return (await tauriReadMeta(path)) ? 'ok' : 'broken';
	} catch {
		return 'permission-needed';
	}
}

export async function tauriOpenNativeGrants(grants: NativeDiskGrant[]): Promise<OpenedDiskFiles> {
	const currentIo = await getIo();
	const markdownGrants = grants.filter((grant) => isMarkdownDiskPath(grant.path));
	registerGrants(markdownGrants);
	return openGrants(markdownGrants, currentIo);
}

async function openGrants(
	grants: NativeDiskGrant[],
	currentIo: TauriDiskIo
): Promise<OpenedDiskFiles> {
	const files: OpenedDiskFile[] = [];
	let failed = 0;
	for (const grant of grants) {
		if (!isMarkdownDiskPath(grant.path)) continue;
		try {
			const content = await currentIo.readText(grant.token);
			const stat = (await currentIo.stat(grant.token)) ?? grant.stat;
			if (!stat) throw new Error('Selected file disappeared before it could be opened.');
			grant.stat = stat;
			files.push({
				name: pathBasename(grant.path) || 'untitled.md',
				content,
				path: grant.path,
				lastModified: stat.lastModified,
				size: stat.size,
				revision: stat.revision,
				link: pathLinkRecord(grant.path)
			});
		} catch {
			failed += 1;
		}
	}
	return { files, failed };
}
