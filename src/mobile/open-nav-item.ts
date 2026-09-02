/**
 * OpenStation — phone layer: open what a navigation item stands for.
 *
 * The home grid and the tab bar paint `NavItem`s, and a tap has to
 * land on the SAME window a dock click would — same id, same tab
 * strip, same native remap. This is the dock's `openPage()` and the
 * icon grid's `openTarget()` folded into one function that takes a
 * `NavItem`, which can carry any of the three sources (`menu`,
 * `tile`, `entry`) at once.
 *
 * Ships in the main bundle: it reaches into the native URL remap
 * table and the external-URL guard, both of which live there.
 */
import { findMenuEntryForUrl } from '../desktop-files/menu-entry';
import { tryOpenExternalUrl } from '../external-url';
import { tryNativeUrlRemap } from '../native-url-remap';
import type { NavItem } from '../nav/types';
import { deriveWindowId } from '../utils';
import type { WindowManager } from '../window-manager';

export interface NavItemOpenerDeps {
	manager: WindowManager;
	adminUrl: string;
	/** Opens a registered native window by id; `false` when unknown. */
	openNative: ( id: string ) => boolean;
}

/**
 * Build the opener. Returns `true` when something opened (or was
 * focused), `false` when the item has nothing to open — a tile
 * whose only opener was removed, a malformed URL.
 */
export function createNavItemOpener( deps: NavItemOpenerDeps ): ( item: NavItem ) => boolean {
	const { manager, adminUrl, openNative } = deps;

	return ( item: NavItem ): boolean => {
		// A native window: focus it if it is already open (it may have
		// arrived by a route the registry cannot reopen), else ask the
		// registry.
		if ( item.windowId ) {
			const existing = manager.getById( item.windowId );
			if ( existing ) {
				if ( existing.isMinimized() ) {
					existing.restore();
				}
				manager.focus( existing );
				return true;
			}
			if ( openNative( item.windowId ) ) {
				return true;
			}
		}

		// A system tile owns its opener.
		if ( item.tile ) {
			item.tile.onOpen();
			return true;
		}

		const url = item.menu?.url || item.entry?.url || '';
		if ( ! url ) {
			return false;
		}
		if ( tryOpenExternalUrl( url ) ) {
			return true;
		}
		if ( tryNativeUrlRemap( url ) ) {
			return true;
		}

		let parsed: URL;
		try {
			parsed = new URL( url, window.location.origin );
		} catch {
			return false;
		}
		const href = parsed.toString();
		const baseId = deriveWindowId( href, adminUrl );
		const menu = item.menu ?? findMenuEntryForUrl( href ) ?? null;
		const icon = item.icon || menu?.icon || 'dashicons-admin-generic';
		void manager.open( {
			id: baseId,
			baseId,
			url: href,
			parentUrl: menu?.url ?? href,
			title: item.title,
			icon: icon.startsWith( 'dashicons-' ) || icon.startsWith( 'data:' ) || /^https?:/.test( icon )
				? icon
				: 'dashicons-admin-generic',
			submenu: menu?.submenu,
			selfLabel: menu?.selfLabel,
			multi: !! menu?.multi,
		} );
		return true;
	};
}
