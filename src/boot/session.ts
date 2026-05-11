/**
 * Boot-time session helpers.
 *
 * Owns the two session-bootstrap operations the shell runs at the
 * end of `init()`: rebuild every window from the saved session,
 * or — if there's no session — open the page the user navigated
 * to. Both functions are pure with respect to module state: every
 * dependency comes through arguments so they're directly
 * testable in isolation.
 *
 * Extracted from `src/desktop.ts` during the architecture-0.8.1
 * boot decomposition (phase 5).
 *
 * @since 0.8.1
 */

import { tryNativeUrlRemap } from '../native-url-remap';
import { deriveWindowId } from '../utils';
import { clampGeometryToViewport, findDockEntryForUrl } from './geometry';
import type { WindowManager } from '../window-manager';
import type { DesktopConfig } from '../types';

/**
 * Restores windows from a saved session into the manager.
 *
 * Each window's geometry is clamped to fit the current desktop
 * area before construction — so a layout captured on an ultrawide
 * display lands sanely on a laptop. Stacking order follows the
 * session order (earliest-opened first, focused id brought to the
 * top at the end).
 *
 * @since 0.8.1 (extracted from desktop.ts)
 */
export function restoreSession(
	manager: WindowManager,
	config: DesktopConfig,
	desktopArea: HTMLElement,
): void {
	const rect = desktopArea.getBoundingClientRect();

	// Seed desktops + active id BEFORE recreating windows. Windows
	// pass `desktopId` from the session through to their config; the
	// manager honours that exactly as long as the desktop already
	// exists in the registry, otherwise it falls back to the active
	// desktop. Establishing the registry first preserves the user's
	// per-desktop window grouping across reloads.
	if (
		Array.isArray( config.session.desktops ) &&
		config.session.desktops.length > 0
	) {
		manager.seedDesktops(
			config.session.desktops,
			config.session.activeDesktop || config.session.desktops[ 0 ].id,
		);
	}

	for ( const win of config.session.windows ) {
		const clamped = clampGeometryToViewport( win, rect );
		const dockEntry = findDockEntryForUrl( win.url, config );

		const opened = manager.open( {
			id: win.id,
			baseId: win.baseId || win.id,
			desktopId: win.desktopId,
			multi: !! dockEntry?.multi,
			url: win.url,
			// `dockEntry?.url` is the parent menu's landing page —
			// recover it so the synthetic "back to parent" tab in
			// the in-window strip points at the dock URL even when
			// the saved `win.url` is a sub-page (e.g. theme-install.php
			// under Appearance, or a deep wc-admin route under
			// WooCommerce). Without this the dedup check in
			// `dom.ts` sees the iframe URL match a submenu entry
			// and suppresses the parent tab — losing the only
			// affordance to navigate back.
			parentUrl: dockEntry?.url ?? win.url,
			title: win.title,
			icon: win.icon || 'dashicons-admin-generic',
			x: clamped.x,
			y: clamped.y,
			width: clamped.width,
			height: clamped.height,
			initialState: win.state,
			submenu: dockEntry?.submenu,
		} );

		// Rehydrate any external sub-tabs the user had open on this
		// window at save time. Each becomes a fresh closeable tab
		// with its own iframe, ordered left-to-right in the order
		// they were added originally.
		if ( Array.isArray( win.externalTabs ) ) {
			for ( const ext of win.externalTabs ) {
				if ( ext && typeof ext.url === 'string' && ext.url !== '' ) {
					opened.addExternalTab(
						ext.url,
						typeof ext.label === 'string' && ext.label !== ''
							? ext.label
							: ext.url,
					);
				}
			}
		}
	}

	// Restore focus to whichever window the user left focused. If
	// that id is no longer around (e.g., the saved focus pointed at
	// a window we failed to reconstruct), `getById` returns
	// undefined and we leave the default — topmost-of-stack — focus
	// in place.
	if ( config.session.focused ) {
		const focused = manager.getById( config.session.focused );
		if ( focused ) {
			manager.focus( focused );
		}
	}
}

/**
 * Opens the current admin page in a fresh window — the "no saved
 * session" path.
 *
 * Honours the native URL-remap registry so a portal deep-link to a
 * page with a registered native replacement (Posts → `edit.php`,
 * etc.) opens the native window when the user has opted in. Falls
 * through to the standard iframe path on no-match.
 *
 * @since 0.8.1 (extracted from desktop.ts)
 */
export function openCurrentPage(
	manager: WindowManager,
	config: DesktopConfig,
): void {
	if ( tryNativeUrlRemap( config.currentPage ) ) {
		return;
	}

	const windowId = deriveWindowId( config.currentPage, config.adminUrl );
	const dockEntry = findDockEntryForUrl( config.currentPage, config );

	manager.open( {
		id: windowId,
		baseId: windowId,
		multi: !! dockEntry?.multi,
		url: config.currentPage,
		parentUrl: dockEntry?.url ?? config.currentPage,
		title: config.currentTitle,
		icon: config.currentIcon,
		submenu: dockEntry?.submenu,
	} );
}
