export interface DropConfig {

	enabled: boolean;

	allowedMimes: string[];

	extToMime?: Record< string, string >;

	maxSize: number;
}

export interface DropDialogFields {

	title: string;

	altText: string;

	caption: string;

	description: string;

	filename: string;
}

export interface DropFileEntry {

	file: File;

	mime: string;

	fields: DropDialogFields;

	relativePath?: string;
}

export interface DesktopStorageConfig {
	canUpload: boolean;
	maxBytes: number;
	quotaBytes: number;
	zipAvailable: boolean;
}

export interface DropRejection {
	file: File;
	reason: 'mime' | 'size' | 'empty' | 'filtered';
	message: string;
}

export interface DropContext {

	surface: 'wallpaper' | 'window' | 'folder' | 'iframe' | 'unknown';

	windowId?: string;

	folderId?: number;

	x: number;
	y: number;
}

export interface DropUploadResult {
	id: number;
	url: string;
	mime: string;
	title: string;
	filename: string;
}
