declare global {
	interface Window {
		showOpenFilePicker?: (opts?: {
			multiple?: boolean;
			excludeAcceptAllOption?: boolean;
			types?: Array<{
				description?: string;
				accept?: Record<string, string[]>;
			}>;
		}) => Promise<FileSystemFileHandle[]>;

		showSaveFilePicker?: (opts?: {
			suggestedName?: string;
			types?: Array<{
				description?: string;
				accept?: Record<string, string[]>;
			}>;
		}) => Promise<FileSystemFileHandle>;

		// §2.3 - Directory import ("vault" mode). Minimal self-contained type
		// (MdshDirectoryHandle) to avoid depending on the completeness of lib.dom.
		showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<MdshDirectoryHandle>;
	}

	interface MdshFileEntry {
		kind: 'file';
		name: string;
		getFile: () => Promise<File>;
	}

	interface MdshDirectoryHandle {
		kind: 'directory';
		name: string;
		values: () => AsyncIterableIterator<MdshFileEntry | MdshDirectoryHandle>;
	}

	interface FileSystemFileHandle {
		queryPermission?: (opts: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
		requestPermission?: (opts: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
		createWritable?: () => Promise<FileSystemWritableFileStream>;
	}
}

export {};
