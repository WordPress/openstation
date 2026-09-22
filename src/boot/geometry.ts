/**
 * Boot-time geometry helpers.
 *
 * Pure functions extracted from `src/desktop.ts` during the
 * architecture-0.8.1 boot decomposition (phase 5). They have no
 * captured state and reach into the rest of the shell only via
 * the `deriveWindowId` utility, so they're safe to live in their
 * own module — and to test in isolation.
 */

import { deriveWindowId } from '../utils';
import type { DesktopConfig, SessionWindow } from '../types';

/**
 * Minimum margin between a clamped window edge and the desktop
 * area edge. Pulled from `desktop.ts` verbatim so existing
 * sessions clamp to the same numbers.
 */
export const VIEWPORT_CLAMP_MARGIN = 12;

/**
 * Find the dock entry — top-level item or a submenu child — whose
 * url derives the same window id as `url`. Returns the *parent*
 * top-level entry in either case so callers can read its
 * `multi` / `submenu` flags. Used by `openCurrentPage()` to
 * decide whether the page being opened should inherit dock
 * metadata.
 */
export function findDockEntryForUrl(
	url: string,
	config: DesktopConfig,
): DesktopConfig[ 'dockItems' ][ number ] | undefined {
	return findDockEntryForWindowId(
		deriveWindowId( url, config.adminUrl ),
		config,
	);
}

/**
 * Find the dock entry — top-level item or a submenu child — whose
 * url derives `windowId`. Returns the *parent* top-level entry in
 * either case, like {@link findDockEntryForUrl}.
 *
 * This is the session-restore fallback for windows whose CURRENT
 * URL matches no menu entry: a page that redirected to an
 * onboarding screen the menu doesn't list (MailPoet parks every
 * page on `?page=mailpoet-landingpage` until its wizard is done).
 * The saved window still carries its open-time identity in
 * `baseId`, and matching THAT against the dock recovers the owning
 * entry — so the window's submenu tab strip survives the reload
 * instead of silently vanishing.
 */
export function findDockEntryForWindowId(
	windowId: string,
	config: DesktopConfig,
): DesktopConfig[ 'dockItems' ][ number ] | undefined {
	if ( ! windowId ) {
		return undefined;
	}
	return ( config.dockItems || [] ).find(
		( i ) =>
			deriveWindowId( i.url, config.adminUrl ) === windowId ||
			( i.submenu || [] ).some(
				( s ) => deriveWindowId( s.url, config.adminUrl ) === windowId,
			),
	);
}

/**
 * The current menu's name for `url`: the top-level dock entry whose
 * url derives the same window id, or failing that the submenu child
 * that does. `undefined` when the menu lists nothing for it.
 *
 * Session restore uses this instead of the saved title. A window's
 * title is captured in whatever admin language the user had when it
 * was opened, and the saved session outlives a language change, so
 * a restored Posts window kept saying "Entradas" over a dock and a
 * tab strip that had moved on to English. The menu is rebuilt in the
 * current language on every boot, so it is the source of truth; the
 * saved title is only right for a URL the menu does not list (a
 * post being edited, an off-menu onboarding screen), which is when
 * the caller falls back to it.
 *
 * The top-level entry is checked before its children on purpose: a
 * submenu's self-link ("All Posts") shares the parent's URL, and the
 * window should carry the dock's name for the destination ("Posts"),
 * as it does when opened from the dock. A child that is NOT the
 * self-link ("Add Post") names its own page, which is what keeps an
 * "Add Post" window from restoring as "Posts".
 */
export function findDockTitleForUrl(
	url: string,
	config: DesktopConfig,
): string | undefined {
	const windowId = deriveWindowId( url, config.adminUrl );
	if ( ! windowId ) {
		return undefined;
	}
	const items = config.dockItems || [];
	const top = items.find(
		( i ) => deriveWindowId( i.url, config.adminUrl ) === windowId,
	);
	if ( top?.title ) {
		return top.title;
	}
	for ( const item of items ) {
		const child = ( item.submenu || [] ).find(
			( s ) => deriveWindowId( s.url, config.adminUrl ) === windowId,
		);
		if ( child?.title ) {
			return child.title;
		}
	}
	return undefined;
}

/**
 * Clamp a persisted window's geometry to fit inside `rect` — the
 * current WORK area (`workAreaRectOf( desktopArea )`), in
 * desktop-area-local coordinates. Handles the ultrawide-to-laptop
 * transition gracefully:
 *
 *   - A window that sat at x=2800 on a 3440px desktop gets pulled
 *     back onto the smaller viewport.
 *   - A window bigger than the viewport is shrunk to fit (each
 *     axis clamped independently — aspect ratio is not preserved).
 *   - Negative positions (shouldn't happen but defend anyway)
 *     clamp to the 12px margin.
 *   - A window saved with its bottom edge under the dock comes back
 *     above it, because `rect` stops where the dock starts.
 *
 * `rect.x` / `rect.y` are the work area's origin inside the desktop
 * area (0 unless chrome claims a top or left band); a `DOMRect` from
 * `getBoundingClientRect()` is NOT the right input, its `x` / `y` are
 * viewport offsets.
 *
 * Returns a plain geometry object — caller applies it to the
 * `WindowConfig`.
 */
export function clampGeometryToViewport(
	win: SessionWindow,
	rect: { x?: number; y?: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } {
	const originX = rect.x ?? 0;
	const originY = rect.y ?? 0;
	const maxW = Math.max( 200, rect.width - VIEWPORT_CLAMP_MARGIN * 2 );
	const maxH = Math.max( 200, rect.height - VIEWPORT_CLAMP_MARGIN * 2 );

	const width = Math.min( win.width, maxW );
	const height = Math.min( win.height, maxH );

	const maxX = originX + Math.max( 0, rect.width - width - VIEWPORT_CLAMP_MARGIN );
	const maxY = originY + Math.max( 0, rect.height - height - VIEWPORT_CLAMP_MARGIN );

	const x = Math.max( originX + VIEWPORT_CLAMP_MARGIN, Math.min( win.x, maxX ) );
	const y = Math.max( originY + VIEWPORT_CLAMP_MARGIN, Math.min( win.y, maxY ) );

	return { x, y, width, height };
}
