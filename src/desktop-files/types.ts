/**
 * OpenStation — Files-on-the-desktop typed contracts.
 *
 * The serialized shape produced by `OpenStation_File::serialize()`
 * on the PHP side. JS subclasses receive an instance of this shape
 * in their constructor and adapt it to whatever the UI needs.
 *
 * Plugin authors who add a file type register a TS class that
 * extends {@link DesktopFile}; the PHP-side `serialize()` filter
 * lets them attach extra fields, and the TS class consumes those
 * fields via `shape as MyShape` casts in the subclass methods.
 */

export interface DesktopFileShape {
	/** Type slug, e.g. `'post'`, `'user'`, `'folder'`. */
	type: string;
	/** Opaque entity reference (post id as string, URL for bookmarks, …). */
	ref: string;
	/** Display title under the tile. */
	title: string;
	/** Dashicon class or `data:` URI. */
	icon: string;
	/** Optional preview-image URL. Empty string when none. */
	previewUrl: string;
	/** Whether the underlying entity still exists. */
	exists: boolean;
	/** Subclass-specific extra fields are tolerated. */
	[ key: string ]: unknown;
}

/**
 * Server-side file-type metadata. One entry per registered type
 * arrives in the shell payload as `serverFileTypes`.
 */
export interface DesktopFileTypeServerEntry {
	id: string;
	label: string;
	sort: number;
	scriptUrl: string;
	scriptHandle: string;
	scriptBefore: string[];
	scriptAfter: string[];
	scriptL10n: Record< string, string >;
	scriptTranslations: string;
}
