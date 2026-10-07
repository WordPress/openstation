export const DESKTOP_THEME_SLOTS = {

	WINDOW_CONTROL_MINIMIZE: 'WINDOW_CONTROL_MINIMIZE',
	WINDOW_CONTROL_MAXIMIZE: 'WINDOW_CONTROL_MAXIMIZE',
	WINDOW_CONTROL_FULLSCREEN: 'WINDOW_CONTROL_FULLSCREEN',
	WINDOW_CONTROL_FULLSCREEN_EXIT: 'WINDOW_CONTROL_FULLSCREEN_EXIT',
	WINDOW_CONTROL_CLOSE: 'WINDOW_CONTROL_CLOSE',
	WINDOW_CONTROL_MENU: 'WINDOW_CONTROL_MENU',
	WINDOW_CONTROL_RELOAD: 'WINDOW_CONTROL_RELOAD',
	WINDOW_CONTROL_DETACH: 'WINDOW_CONTROL_DETACH',

	OS_SETTINGS: 'OS_SETTINGS',
	RECYCLE_BIN: 'RECYCLE_BIN',
	BUG_REPORT: 'BUG_REPORT',
	EXIT_OPENSTATION: 'EXIT_OPENSTATION',
	PWA_INSTALL: 'PWA_INSTALL',

	DEFAULT_APP_ICON: 'DEFAULT_APP_ICON',

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

	RECYCLE_RESTORE: 'RECYCLE_RESTORE',
	RECYCLE_DELETE: 'RECYCLE_DELETE',
} as const;

export type DesktopThemeSlot =
	( typeof DESKTOP_THEME_SLOTS )[ keyof typeof DESKTOP_THEME_SLOTS ];

const SYSTEM_TILE_SLOTS: Record< string, string > = {
	'desktop-mode-os-settings': DESKTOP_THEME_SLOTS.OS_SETTINGS,
	'desktop-mode-recycle-bin': DESKTOP_THEME_SLOTS.RECYCLE_BIN,
	'desktop-mode-bug-report': DESKTOP_THEME_SLOTS.BUG_REPORT,
	'os-exit': DESKTOP_THEME_SLOTS.EXIT_OPENSTATION,
	'os-pwa-install': DESKTOP_THEME_SLOTS.PWA_INSTALL,
};

export function slotForTileId( id: string ): string {
	if ( typeof id !== 'string' || id === '' ) {
		return '';
	}
	const system = SYSTEM_TILE_SLOTS[ id ];
	if ( system ) {
		return system;
	}

	const slug = id.toLowerCase().replace( /[^a-z0-9_-]/g, '' );
	return slug === '' ? '' : `APP:${ slug }`;
}

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
