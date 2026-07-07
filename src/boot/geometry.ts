/**
 * Boot-time geometry helpers.
 *
 * Pure functions extracted from `src/desktop.ts` during the
 * architecture-0.8.1 boot decomposition (phase 5). They have no
 * captured state and reach into the rest of the shell only via
 * the `deriveWindowId` utility, so they're safe to live in their
 * own module — and to test in isolation.
 *
 * @since 0.8.1
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
 *
 * @since 0.8.1 (extracted from desktop.ts)
 */
export function findDockEntryForUrl(
	url: string,
	config: DesktopConfig,
): DesktopConfig[ 'dockItems' ][ number ] | undefined {
	const windowId = deriveWindowId( url, config.adminUrl );
	return ( config.dockItems || [] ).find(
		( i ) =>
			deriveWindowId( i.url, config.adminUrl ) === windowId ||
			( i.submenu || [] ).some(
				( s ) => deriveWindowId( s.url, config.adminUrl ) === windowId,
			),
	);
}

/**
 * Clamp a persisted window's geometry to fit inside the current
 * desktop area. Handles the ultrawide-to-laptop transition
 * gracefully:
 *
 *   - A window that sat at x=2800 on a 3440px desktop gets pulled
 *     back onto the smaller viewport.
 *   - A window bigger than the viewport is shrunk to fit (each
 *     axis clamped independently — aspect ratio is not preserved).
 *   - Negative positions (shouldn't happen but defend anyway)
 *     clamp to the 12px margin.
 *
 * Returns a plain geometry object — caller applies it to the
 * `WindowConfig`.
 *
 * @since 0.8.1 (extracted from desktop.ts)
 */
export function clampGeometryToViewport(
	win: SessionWindow,
	rect: DOMRect,
): { x: number; y: number; width: number; height: number } {
	const maxW = Math.max( 200, rect.width - VIEWPORT_CLAMP_MARGIN * 2 );
	const maxH = Math.max( 200, rect.height - VIEWPORT_CLAMP_MARGIN * 2 );

	const width = Math.min( win.width, maxW );
	const height = Math.min( win.height, maxH );

	const maxX = Math.max( 0, rect.width - width - VIEWPORT_CLAMP_MARGIN );
	const maxY = Math.max( 0, rect.height - height - VIEWPORT_CLAMP_MARGIN );

	const x = Math.max( VIEWPORT_CLAMP_MARGIN, Math.min( win.x, maxX ) );
	const y = Math.max( VIEWPORT_CLAMP_MARGIN, Math.min( win.y, maxY ) );

	return { x, y, width, height };
}
