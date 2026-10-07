import { findMenuEntryForUrl } from '../desktop-files/menu-entry';
import { tryOpenExternalUrl } from '../external-url';
import { tryNativeUrlRemap } from '../native-url-remap';
import type { NavItem } from '../nav/types';
import { deriveWindowId } from '../utils';
import type { WindowManager } from '../window-manager';

export interface NavItemOpenerDeps {
	manager: WindowManager;
	adminUrl: string;

	openNative: ( id: string ) => boolean;
}

export function createNavItemOpener( deps: NavItemOpenerDeps ): ( item: NavItem ) => boolean {
	const { manager, adminUrl, openNative } = deps;

	return ( item: NavItem ): boolean => {
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
