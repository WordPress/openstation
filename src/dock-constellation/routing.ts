/**
 * Window routing for the constellation flyout.
 *
 * The flyout is a second front door onto exactly the windows a dock
 * click already opens, so it MUST address them by the same ids —
 * otherwise hovering "Appearance → Themes" and clicking the
 * Appearance tile would produce two windows of the same page, and
 * neither the dock indicator nor the hover-peek would recognise the
 * other's.
 *
 * Everything here mirrors `Dock.openPage()` and the layout
 * dispatcher's `buildMountDeps().openSubmenuPick()`: same
 * `deriveWindowId( url, adminUrl )` key, same external-URL escape,
 * same native-window remap consult, same `parentUrl` pinning. The
 * duplication is deliberate — both of those live inside closures we
 * can't reach from here, and forwarding through the dispatcher would
 * mean widening its public interface for one internal caller.
 */

import type { DockItem, SubmenuItem } from '../dock';
import { tryOpenExternalUrl } from '../external-url';
import {
	resolveNativeUrlRemap,
	tryNativeUrlRemap,
} from '../native-url-remap';
import { deriveWindowId } from '../utils';
import type { WindowManager } from '../window-manager';

/** Dashicons pass through; anything else falls back to the generic cog. */
function safeIcon( icon: string ): string {
	return icon.startsWith( 'dashicons-' ) ? icon : 'dashicons-admin-generic';
}

export interface ConstellationRouting {
	windowManager: WindowManager;
	adminUrl: string;
}

/**
 * Open (or focus) a menu's own landing page — what clicking the dock
 * tile does.
 */
export function openMenuItem(
	deps: ConstellationRouting,
	item: DockItem,
): void {
	if ( item.url && tryOpenExternalUrl( item.url ) ) {
		return;
	}
	if ( item.url && tryNativeUrlRemap( item.url ) ) {
		return;
	}
	const baseId = deriveWindowId( item.url, deps.adminUrl );
	deps.windowManager.open( {
		id: baseId,
		baseId,
		url: item.url,
		parentUrl: item.url,
		title: item.title,
		icon: safeIcon( item.icon ),
		submenu: item.submenu,
		multi: !! item.multi,
	} );
}

/**
 * Open a submenu entry.
 *
 * `parentUrl` pins to the PARENT's landing page rather than to the
 * sub-page, so the window's tab strip still offers a way back to the
 * menu's own screen — the same reason the dispatcher's
 * `openSubmenuPick` does it.
 */
export function openSubmenuItem(
	deps: ConstellationRouting,
	item: DockItem,
	sub: SubmenuItem,
): void {
	if ( tryOpenExternalUrl( sub.url ) ) {
		return;
	}
	if ( tryNativeUrlRemap( sub.url ) ) {
		return;
	}
	deps.windowManager.open( {
		id: deriveWindowId( sub.url, deps.adminUrl ),
		baseId: deriveWindowId( item.url, deps.adminUrl ),
		url: sub.url,
		parentUrl: item.url,
		title: item.title,
		icon: safeIcon( item.icon ),
		submenu: item.submenu,
		multi: !! item.multi,
	} );
}

/** Spawn a fresh instance of the menu's landing page. */
export function openNewMenuItem(
	deps: ConstellationRouting,
	item: DockItem,
): void {
	if ( item.url && tryOpenExternalUrl( item.url ) ) {
		return;
	}
	const openNewWindow = window.wp?.os?.openNewWindow;
	if ( item.windowId && ! item.url ) {
		if ( openNewWindow?.( item.windowId, { source: 'dock-constellation' } ) ) {
			return;
		}
	}
	// A URL claimed by a native window has to spawn a duplicate of THAT
	// window, not a chromeless iframe of the URL it replaced.
	const remappedId = resolveNativeUrlRemap( item.url );
	if ( remappedId ) {
		if ( openNewWindow?.( remappedId, { source: 'dock-constellation' } ) ) {
			return;
		}
	}
	const baseId = deriveWindowId( item.url, deps.adminUrl );
	void deps.windowManager.openNew( {
		id: baseId,
		baseId,
		url: item.url,
		parentUrl: item.url,
		title: item.title,
		icon: safeIcon( item.icon ),
		submenu: item.submenu,
		multi: true,
	} );
}
