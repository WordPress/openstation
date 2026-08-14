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
 */

import { tryNativeUrlRemap } from '../native-url-remap';
import { deriveWindowId } from '../utils';
import { clampGeometryToViewport, findDockEntryForUrl } from './geometry';
import type { WindowManager } from '../window-manager';
import type { Window } from '../window';
import type { DesktopConfig, Session, WindowConfig } from '../types';

/**
 * Whether the saved payload carries meaningful shell state to restore.
 *
 * A session can be worth restoring even when it has no windows: virtual
 * desktops live in the same payload, and pinned notes / desktop files can
 * make an otherwise empty workspace meaningful. The server always sends a
 * default one-desktop shape, so keep that as "empty" until the user has
 * actually saved a customized desktop registry.
 */
export function hasRestorableSession(
	session: Session | undefined,
): boolean {
	if ( ! session ) {
		return false;
	}
	if ( Array.isArray( session.windows ) && session.windows.length > 0 ) {
		return true;
	}
	if (
		typeof session.updated !== 'number' ||
		session.updated <= 0 ||
		! Array.isArray( session.desktops ) ||
		session.desktops.length === 0
	) {
		return false;
	}
	if ( session.desktops.length > 1 ) {
		return true;
	}
	const onlyDesktop = session.desktops[ 0 ];
	if ( onlyDesktop?.id && onlyDesktop.id !== 'desktop-1' ) {
		return true;
	}
	return !! session.activeDesktop && session.activeDesktop !== 'desktop-1';
}

/**
 * Reopen a native window by id. Supplied by `desktop.ts`, which owns
 * the dispatch: shell built-ins (OS Settings, Bug Report) have their
 * own openers, everything else routes to
 * `nativeWindows.openById( id )`.
 *
 * Returns `false` when nothing answers to that id — a plugin
 * deactivated since the session was saved. The restore skips those
 * silently; a missing plugin isn't an error worth surfacing at boot.
 */
export type OpenNativeWindow = ( id: string ) => boolean;

/**
 * Wait for a window to appear in the manager, for openers that don't
 * hand back the `Window` they create.
 *
 * The native openers are fire-and-forget (`void manager.open( … )`),
 * so restore has no promise to await between windows. Without a
 * barrier the opens race: stacking order scrambles, and the
 * focused-window restore at the end can run before its target
 * exists. Listening for the lifecycle event the manager already
 * dispatches keeps the sequence deterministic without changing every
 * opener's signature.
 *
 * Resolves `null` on timeout rather than rejecting — one window that
 * never materialises must not abort the rest of the restore.
 */
function waitForWindow(
	manager: WindowManager,
	id: string,
	timeoutMs = 5000,
): Promise< Window | null > {
	const existing = manager.getById( id );
	if ( existing ) {
		return Promise.resolve( existing );
	}
	return new Promise( ( resolve ) => {
		const done = ( win: Window | null ): void => {
			window.clearTimeout( timer );
			document.removeEventListener( 'os-window-opened', onOpened );
			resolve( win );
		};
		const onOpened = ( e: Event ): void => {
			const detail = ( e as CustomEvent ).detail as
				| { windowId?: string }
				| undefined;
			if ( detail?.windowId === id ) {
				done( manager.getById( id ) ?? null );
			}
		};
		const timer = window.setTimeout( () => done( null ), timeoutMs );
		document.addEventListener( 'os-window-opened', onOpened );
	} );
}

/**
 * Restores windows from a saved session into the manager.
 *
 * Each window's geometry is clamped to fit the current desktop
 * area before construction — so a layout captured on an ultrawide
 * display lands sanely on a laptop. Stacking order follows the
 * session order (earliest-opened first, focused id brought to the
 * top at the end).
 *
 * Two kinds of window come back by two different routes. Plain admin
 * windows are reconstructed from their saved URL. Native windows
 * (`native: true` — OS Settings, Bug Report, anything registered via
 * `openstation_register_window()`) have no URL to iframe: they're
 * reopened by asking their owner through `openNative`, with the saved
 * geometry / desktop / state staged via
 * `manager.seedWindowRestoreState()` so the opener's own config
 * doesn't flatten them back to defaults.
 */
export async function restoreSession(
	manager: WindowManager,
	config: DesktopConfig,
	desktopArea: HTMLElement,
	openNative?: OpenNativeWindow,
): Promise< void > {
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

	// Stage every native window's saved geometry / desktop / state
	// before triggering any open. The openers build their own
	// `manager.open()` config from the registry and have no argument
	// to carry restore-time values, so the manager merges these in by
	// id as each window is constructed.
	const nativeSeeds: Record< string, Partial< WindowConfig > > = {};
	for ( const win of config.session.windows ) {
		if ( ! win.native ) {
			continue;
		}
		const clamped = clampGeometryToViewport( win, rect );
		nativeSeeds[ win.id ] = {
			desktopId: win.desktopId,
			initialState: win.state,
			x: clamped.x,
			y: clamped.y,
			width: clamped.width,
			height: clamped.height,
			// What the window was showing, not just which window it
			// was. A native window is addressed by id, so without this
			// a singleton that retargets (the profile editor, the
			// customer window) reopens on its default and reads as
			// having silently changed subject.
			...( win.params ? { params: win.params } : {} ),
		};
	}
	if ( Object.keys( nativeSeeds ).length > 0 ) {
		manager.seedWindowRestoreState( nativeSeeds );
	}

	for ( const win of config.session.windows ) {
		// Native windows come back through their owner, not through a
		// URL. `openNative` returns false when nothing answers to the
		// id — a plugin deactivated since the session was saved — in
		// which case there's simply no window to restore.
		if ( win.native ) {
			if ( ! openNative?.( win.id ) ) {
				continue;
			}
			// Barrier: the openers are fire-and-forget, so without this
			// the remaining windows race them and the stacking order
			// the session captured is lost.
			await waitForWindow( manager, win.id );
			continue;
		}

		const clamped = clampGeometryToViewport( win, rect );
		const dockEntry = findDockEntryForUrl( win.url, config );

		// `openNew`, not `open`. Restore means "recreate exactly this
		// set of windows", and `open()` is the wrong verb for that: it
		// matches on baseId, so a session holding two instances of one
		// page (`edit-php` + `edit-php-2`, both baseId `edit-php`)
		// collapsed on reload — the second call found the first
		// instance, focused it, and returned it, so only one window
		// came back. Worse, when the two had been navigated apart the
		// URL-reuse check then dragged the survivor to the SECOND
		// window's URL, losing the first page as well. `openNew`
		// always constructs, and honours the saved instance id
		// verbatim (see the note on `WindowManager.openNew`).
		const opened = await manager.openNew( {
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
			selfLabel: dockEntry?.selfLabel,
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
 */
export async function openCurrentPage(
	manager: WindowManager,
	config: DesktopConfig,
): Promise< void > {
	if ( tryNativeUrlRemap( config.currentPage ) ) {
		return;
	}

	const windowId = deriveWindowId( config.currentPage, config.adminUrl );
	const dockEntry = findDockEntryForUrl( config.currentPage, config );

	await manager.open( {
		id: windowId,
		baseId: windowId,
		multi: !! dockEntry?.multi,
		url: config.currentPage,
		parentUrl: dockEntry?.url ?? config.currentPage,
		title: config.currentTitle,
		icon: config.currentIcon,
		submenu: dockEntry?.submenu,
		selfLabel: dockEntry?.selfLabel,
	} );
}
