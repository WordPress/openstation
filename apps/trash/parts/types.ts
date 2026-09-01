/**
 * Recycle Bin — wire shapes.
 *
 * What the store serves and the bulk endpoints answer, shared by the
 * Trash app (`apps/trash/`), the table cell renderers
 * (`table-visuals.ts`) and the chunked empty-loop driver. Pure
 * types, no runtime.
 *
 * @public
 */

export interface RecycleBinItem {
	id: number;
	type: string;
	/**
	 * Human-friendly singular label for the item's type. Populated
	 * server-side from the post-type-object label (or "Comment" /
	 * "Media") so CPTs render correctly. May be empty for legacy or
	 * filter-extended rows — the renderer falls back to a
	 * title-cased version of `type`.
	 */
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

/**
 * `{ id, type }` pair the restore / purge surfaces accept. Sending
 * the type with each id lets the server dispatch to the right
 * function — comments go through `wp_untrash_comment`, posts through
 * `wp_untrash_post`.
 */
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
