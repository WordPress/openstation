/**
 * Desktop-theme icon slot names.
 *
 * **This list is a contract.** It must stay equal to the PHP
 * allowlist in `openstation_desktop_theme_icon_slots()`
 * (`includes/desktop-themes/store.php`) — a slot that exists on one
 * side only is either silently dropped at upload time or silently
 * never consulted at render time, and both failure modes look like
 * "my icon didn't apply" to a theme author.
 *
 * Two things are deliberately NOT slots:
 *
 *   - **Letter badges.** They are generated text, not artwork; a
 *     theme retints them through the `--os-tile-*` tokens.
 *   - **`<os-icon>` content icons.** Those live inside window
 *     BODIES, not chrome. Theming them is a documented non-goal for
 *     v1 — see docs/desktop-themes.md.
 */

/**
 * Every fixed slot a manifest may address. Apps use the dynamic
 * `APP:<slug>` form instead (see {@link slotForTileId}).
 *
 * @public
 */
export const DESKTOP_THEME_SLOTS = {
	// Window controls — one per `<os-window-button>` built-in key.
	WINDOW_CONTROL_MINIMIZE: 'WINDOW_CONTROL_MINIMIZE',
	WINDOW_CONTROL_MAXIMIZE: 'WINDOW_CONTROL_MAXIMIZE',
	WINDOW_CONTROL_FULLSCREEN: 'WINDOW_CONTROL_FULLSCREEN',
	WINDOW_CONTROL_FULLSCREEN_EXIT: 'WINDOW_CONTROL_FULLSCREEN_EXIT',
	WINDOW_CONTROL_CLOSE: 'WINDOW_CONTROL_CLOSE',
	WINDOW_CONTROL_MENU: 'WINDOW_CONTROL_MENU',
	WINDOW_CONTROL_RELOAD: 'WINDOW_CONTROL_RELOAD',
	WINDOW_CONTROL_DETACH: 'WINDOW_CONTROL_DETACH',
	// System tiles.
	OS_SETTINGS: 'OS_SETTINGS',
	RECYCLE_BIN: 'RECYCLE_BIN',
	BUG_REPORT: 'BUG_REPORT',
	EXIT_OPENSTATION: 'EXIT_OPENSTATION',
	PWA_INSTALL: 'PWA_INSTALL',
	// Apps.
	DEFAULT_APP_ICON: 'DEFAULT_APP_ICON',
	// Desktop files.
	FOLDER: 'FOLDER',
	FILE_SHORTCUT: 'FILE_SHORTCUT',
	FILE_POST: 'FILE_POST',
	FILE_ATTACHMENT: 'FILE_ATTACHMENT',
	FILE_UPLOAD: 'FILE_UPLOAD',
	FILE_USER: 'FILE_USER',
	FILE_TERM: 'FILE_TERM',
	FILE_COMMENT: 'FILE_COMMENT',
	FILE_BOOKMARK: 'FILE_BOOKMARK',
	FILE_LINK: 'FILE_LINK',
	FILE_EMBED: 'FILE_EMBED',
	// Recycle-bin row actions.
	RECYCLE_RESTORE: 'RECYCLE_RESTORE',
	RECYCLE_DELETE: 'RECYCLE_DELETE',
} as const;

/** Union of every fixed slot name. */
export type DesktopThemeSlot =
	( typeof DESKTOP_THEME_SLOTS )[ keyof typeof DESKTOP_THEME_SLOTS ];

/**
 * Built-in shell tiles that get a dedicated slot instead of the
 * generic `APP:<id>` form. Keyed by the tile id the dock and the
 * desktop-icon grid use.
 */
const SYSTEM_TILE_SLOTS: Record< string, string > = {
	'desktop-mode-os-settings': DESKTOP_THEME_SLOTS.OS_SETTINGS,
	'desktop-mode-recycle-bin': DESKTOP_THEME_SLOTS.RECYCLE_BIN,
	'desktop-mode-bug-report': DESKTOP_THEME_SLOTS.BUG_REPORT,
	'os-exit': DESKTOP_THEME_SLOTS.EXIT_OPENSTATION,
	'os-pwa-install': DESKTOP_THEME_SLOTS.PWA_INSTALL,
};

/**
 * Resolve the icon slot for a dock tile / desktop icon / native
 * window id.
 *
 * Built-in system tiles map to their dedicated slot; everything else
 * becomes `APP:<id>` so a theme can target an individual admin page
 * or plugin window by name.
 *
 * @public
 *
 * @param id Tile id.
 * @return Slot name, or `''` when the id is unusable.
 */
export function slotForTileId( id: string ): string {
	if ( typeof id !== 'string' || id === '' ) {
		return '';
	}
	const system = SYSTEM_TILE_SLOTS[ id ];
	if ( system ) {
		return system;
	}
	// Mirrors PHP's `sanitize_key()` so the slot a theme author
	// writes in `theme.json` is the slot we look up at render time.
	const slug = id.toLowerCase().replace( /[^a-z0-9_-]/g, '' );
	return slug === '' ? '' : `APP:${ slug }`;
}

/**
 * Resolve the icon slot for a window-control id.
 *
 * Built-ins (`core/minimize` → `WINDOW_CONTROL_MINIMIZE`) get their
 * documented slot. Vendor controls are upper-snaked from their full
 * id (`acme/pin` → `WINDOW_CONTROL_ACME_PIN`) so a theme CAN address
 * them — they just won't be on the PHP allowlist unless a plugin
 * widens it via `openstation_desktop_theme_icon_slots`.
 *
 * @public
 *
 * @param id Control id.
 * @return Slot name, or `''` when the id is unusable.
 */
export function slotForWindowControl( id: string ): string {
	if ( typeof id !== 'string' || id === '' ) {
		return '';
	}
	const upper = id
		.replace( /^core\//, '' )
		.toUpperCase()
		.replace( /[^A-Z0-9]+/g, '_' )
		.replace( /^_+|_+$/g, '' );
	return upper === '' ? '' : `WINDOW_CONTROL_${ upper }`;
}

/**
 * Resolve the icon slot for a desktop-file type slug
 * (`folder` → `FOLDER`, `post` → `FILE_POST`).
 *
 * @public
 *
 * @param type File-type slug.
 * @return Slot name, or `''` when the type has no slot.
 */
export function slotForFileType( type: string ): string {
	if ( typeof type !== 'string' || type === '' ) {
		return '';
	}
	if ( type === 'folder' ) {
		return DESKTOP_THEME_SLOTS.FOLDER;
	}
	const upper = type.toUpperCase().replace( /[^A-Z0-9]+/g, '_' );
	const slot = `FILE_${ upper }`;
	return slot in DESKTOP_THEME_SLOTS ? slot : '';
}
