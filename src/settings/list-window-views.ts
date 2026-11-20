/**
 * The layout each native list window opens on, remembered per user in
 * the OS settings.
 *
 * {@link LIST_WINDOW_VIEWS} is the one list of layouts: the settings
 * default, the settings sanitizer and the windows all read it. Its PHP
 * twin is `OPENSTATION_OS_SETTINGS_LIST_VIEWS` in
 * `includes/os-settings.php`; the two must stay equal, or the server
 * drops a layout the browser offers.
 *
 * A leaf module on purpose: the app bundles import it, so it must not
 * pull in the settings store or anything else.
 */

/** Each window's layouts. The first one is the window's default. */
export const LIST_WINDOW_VIEWS = {
	nativePostsView: [ 'desk', 'table' ],
	nativePagesView: [ 'desk', 'table' ],
	nativeUsersView: [ 'people', 'table' ],
} as const;

export type ListWindowViewKey = keyof typeof LIST_WINDOW_VIEWS;
export type ListWindowView< K extends ListWindowViewKey > = ( typeof LIST_WINDOW_VIEWS )[ K ][ number ];

/** `raw` if it is one of the window's layouts, the window's default otherwise. */
export function toListWindowView< K extends ListWindowViewKey >( key: K, raw: unknown ): ListWindowView< K > {
	const views: readonly unknown[] = LIST_WINDOW_VIEWS[ key ];
	return ( views.includes( raw ) ? raw : views[ 0 ] ) as ListWindowView< K >;
}

/**
 * The layout this user last picked for the window. Synchronous, so the
 * state a window is created with already holds it and the first paint
 * is the right layout.
 */
export function storedListWindowView< K extends ListWindowViewKey >( key: K ): ListWindowView< K > {
	let raw: unknown;
	try {
		const api = window.wp?.os;
		if ( api && typeof api.getOsSettings === 'function' ) {
			raw = ( api.getOsSettings() as unknown as Record< string, unknown > )[ key ];
		}
	} catch {
		// No readable settings: the window opens on its default.
	}
	return toListWindowView( key, raw );
}

/**
 * Remember the layout for the window's next open.
 *
 * Saved through `wp.os.updateOsSettings()`, not an app action: an
 * action dispatch re-runs the app's `data()`, a whole list query, just
 * to store one word.
 */
export function saveListWindowView< K extends ListWindowViewKey >( key: K, view: ListWindowView< K >, windowId: string ): void {
	const api = window.wp?.os;
	if ( api && typeof api.updateOsSettings === 'function' ) {
		api.updateOsSettings( { [ key ]: view }, { windowId } );
	}
}
