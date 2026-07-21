/**
 * Drop manager configuration — what files the JS will accept
 * and how large they can be before the manager rejects them.
 * Sourced from the server (`includes/render/assets.php`) so the
 * client policy matches the WordPress allow-list exactly.
 *
 * @since 0.30.0
 */
export interface DropConfig {
	/** True when the user has `upload_files`. */
	enabled: boolean;
	/**
	 * Flat list of canonical MIME types the server will accept,
	 * derived from `get_allowed_mime_types( $user_id )`.
	 */
	allowedMimes: string[];
	/**
	 * Extension → canonical-MIME map (same shape WordPress
	 * exposes via `get_allowed_mime_types()`). Used to resolve
	 * the MIME for files whose `file.type` is blank (HEIC,
	 * AVIF, …) without the JS guessing.
	 */
	extToMime?: Record< string, string >;
	/**
	 * Per-file size cap in bytes. `0` disables the client-side
	 * cap (the server still enforces its own).
	 */
	maxSize: number;
}

/**
 * OS-file drop manager — type contracts.
 *
 * The OS-file drop manager (`src/os-file-drop/`) catches files
 * the user drags in from the host operating system (Finder,
 * Explorer, Nautilus) onto any surface in Desktop Mode — the
 * wallpaper, a folder window, a native window, or a chromeless
 * admin iframe — and routes them through a confirmation dialog
 * before uploading to the Media Library.
 *
 * @since 0.30.0
 */

/**
 * Editable per-file metadata surfaced in the upload dialog. The
 * manager pre-fills every field with a sensible default derived
 * from the file itself; the user is free to edit any field
 * before confirming the upload.
 */
export interface DropDialogFields {
	/** Sanitized basename without the extension. */
	title: string;
	/** Plain-text alt text (images only — empty otherwise). */
	altText: string;
	/** Plain-text caption. */
	caption: string;
	/** Plain-text long-form description. */
	description: string;
	/**
	 * Sanitized filename WordPress will land the file under.
	 * Includes the extension.
	 */
	filename: string;
}

/**
 * A single file the user dropped, plus the manager's resolved
 * metadata defaults. Subscribers to the
 * `desktop-mode.drop.dialog-fields` filter receive this shape
 * and can mutate the `fields` object before the dialog renders.
 */
export interface DropFileEntry {
	/** The underlying `File`. */
	file: File;
	/** MIME type WordPress will accept the file under. */
	mime: string;
	/** Default metadata. */
	fields: DropDialogFields;
	/**
	 * Tree path (`docs/reports/q1.pdf`) when the file arrived via a
	 * folder drop. Empty/absent for flat files. Desktop-storage
	 * uploads recreate the directory chain server-side from this.
	 *
	 * @since 0.9.6
	 */
	relativePath?: string;
}

/**
 * Desktop-storage config slice (mirrors `config.desktopStorage`
 * injected by the server).
 *
 * @since 0.9.6
 */
export interface DesktopStorageConfig {
	canUpload: boolean;
	maxBytes: number;
	quotaBytes: number;
	zipAvailable: boolean;
}

/**
 * A file the manager rejected before the dialog rendered. The
 * shell toasts a one-line summary; subscribers to the
 * `desktop-mode.drop.files-rejected` action see the full list.
 */
export interface DropRejection {
	file: File;
	reason: 'mime' | 'size' | 'empty' | 'filtered';
	message: string;
}

/**
 * Context for every life-cycle hook the drop manager fires.
 * Plugins use this to scope their reaction to a specific surface
 * (the wallpaper, a particular window, an iframe).
 */
export interface DropContext {
	/**
	 * The shell surface the user released the pointer on:
	 *
	 *   - `'wallpaper'`  — empty desktop / wallpaper area.
	 *   - `'window'`     — a native or iframe window body
	 *                      (`windowId` is populated).
	 *   - `'folder'`     — inside a desktop folder grid.
	 *   - `'iframe'`     — a chromeless admin iframe forwarded
	 *                      the drop up to the shell.
	 *   - `'unknown'`    — the manager couldn't classify the
	 *                      drop target.
	 */
	surface: 'wallpaper' | 'window' | 'folder' | 'iframe' | 'unknown';
	/** Source window id when the drop happened over a window. */
	windowId?: string;
	/**
	 * Folder id when the drop landed on a folder surface (resolved
	 * from the layer host's `data-folder-id`). 0 / absent = desktop
	 * root.
	 *
	 * @since 0.9.6
	 */
	folderId?: number;
	/** Viewport coordinates of the pointer at drop time. */
	x: number;
	y: number;
}

/**
 * Successful upload result.
 */
export interface DropUploadResult {
	id: number;
	url: string;
	mime: string;
	title: string;
	filename: string;
}
