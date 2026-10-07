export interface RecycleBinItem {
	id: number;
	type: string;

	type_label?: string;
	title: string;
	subtitle: string;
	mime: string;
	preview: string;
	icon: string;
	deleted_at: string;
	deleted_by: string;
	deleted_by_id: number;
	can_restore: boolean;
	can_purge: boolean;
	edit_link: string;
	[ key: string ]: unknown;
}

export interface RecycleBinItemRef {
	id: number;
	type: string;
}

export interface ListResponse {
	items: RecycleBinItem[];
	total: number;
}

export interface BulkResponse {
	ok: number[];
	errors: Array< { id: number; code: string; message: string } >;
}

export interface EmptyResponse {
	purged: number;
	skipped: number;
	remaining: number;
}
