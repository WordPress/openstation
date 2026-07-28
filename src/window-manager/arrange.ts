/**
 * Desktop Mode — Window arrangement algorithms.
 *
 * `cascade` and `tile` are the two "Arrange" commands exposed from the
 * admin-bar menu. Both touch every window on the active desktop, so
 * they sit outside the class body to keep the orchestrator file
 * readable. Snap config + grid validation live in sibling modules
 * (`snap.ts`, `geometry.ts`).
 */

import { applyFilters, doAction, HOOKS } from '../hooks';
import { isValidGrid, pickGridDimensions } from './geometry';
import type { WindowManager } from './index';

/**
 * Cascade-lay-out every eligible window from the top-left of the
 * desktop area, each offset so previous windows' title bars stay
 * visible. Mirrors the classic Windows / macOS "cascade windows"
 * behavior; resets any fullscreen/maximized/minimized state first so
 * the cascade actually takes effect.
 *
 * Eligibility:
 *   - Not native (OS Settings etc. are pinned)
 *   - Will be restored from minimized so all windows are visible
 *
 * Sizing: uniform — 70 % of the desktop area's minor axes, capped so a
 * 4K screen doesn't produce absurdly large windows. Offset wraps back
 * to the start after enough steps fit — a 20-window cascade on a 1080p
 * screen reuses the top-left after ~8 steps.
 */
export function cascade( mgr: WindowManager ): void {
	// Cascade only the active desktop's windows — windows belonging to
	// other desktops are hidden and re-laying them out would
	// invalidate the user's saved geometry there. Native windows
	// participate: they're windows with content, same as iframes from
	// cascade's point of view.
	const eligible = mgr._stack.filter(
		( w ) => w.config.desktopId === mgr._activeDesktopId,
	);
	if ( eligible.length === 0 ) {
		return;
	}

	doAction( HOOKS.ARRANGE_CASCADE_STARTING, {
		windowCount: eligible.length,
	} );

	// Normalize state: no fullscreen/maximized during cascade, no
	// minimized so every window appears in the new layout.
	// Restore-from-minimized runs FIRST because `restore()` returns the
	// window to its pre-minimize state (which may itself be
	// fullscreen/maximized) — the unwind passes below then see that
	// state and bring it down to 'normal'.
	for ( const w of eligible ) {
		if ( w.state === 'minimized' ) {
			w.restore();
		}
		if ( w.state === 'fullscreen' ) {
			w.toggleFullscreen();
		}
		if ( w.state === 'maximized' ) {
			w.toggleMaximize();
		}
	}

	const rect = mgr._desktop.getBoundingClientRect();
	const padding = 30;
	const offset = 30;
	const targetWidth = Math.min( Math.round( rect.width * 0.7 ), 1100 );
	const targetHeight = Math.min( Math.round( rect.height * 0.75 ), 750 );

	// How many offsets fit before we'd cascade a window off the
	// bottom / right edge — clamped to at least 1 so we don't divide
	// by zero on micro-viewports.
	const maxStepsX = Math.max(
		1,
		Math.floor( ( rect.width - targetWidth - padding ) / offset ),
	);
	const maxStepsY = Math.max(
		1,
		Math.floor( ( rect.height - targetHeight - padding ) / offset ),
	);
	const maxSteps = Math.min( maxStepsX, maxStepsY );

	eligible.forEach( ( w, i ) => {
		const step = i % Math.max( 1, maxSteps );
		w.element.style.left = `${ padding + step * offset }px`;
		w.element.style.top = `${ padding + step * offset }px`;
		w.element.style.width = `${ targetWidth }px`;
		w.element.style.height = `${ targetHeight }px`;
	} );

	// Bring focused window to the visual top (z-order) so after the
	// cascade the user's prior focus target is still active.
	const focused = mgr.getFocused();
	if ( focused ) {
		mgr.focus( focused );
	}

	// Persist the new geometry — session saver listens to this.
	document.dispatchEvent(
		new CustomEvent( 'desktop-mode-window-changed', {
			detail: { reason: 'cascade' },
		} ),
	);

	doAction( HOOKS.ARRANGE_CASCADE_APPLIED, {
		windowCount: eligible.length,
	} );
}

/**
 * Tile every eligible window into a uniform grid that covers the
 * desktop area — "Show all windows," macOS-style. The grid dimensions
 * (cols × rows) are picked to maximise individual window size while
 * still fitting all of them, by matching the cell aspect ratio to the
 * desktop area's aspect ratio.
 */
export function tile( mgr: WindowManager ): void {
	const eligible = mgr._stack.filter(
		( w ) => w.config.desktopId === mgr._activeDesktopId,
	);
	if ( eligible.length === 0 ) {
		return;
	}

	// Normalize state: no fullscreen / maximized / minimized — every
	// window participates in the tiled grid. Restore-from-minimized
	// runs FIRST because `restore()` returns the window to its pre-
	// minimize state (potentially fullscreen / maximized); the unwind
	// passes below have to come after that to actually catch it.
	for ( const w of eligible ) {
		if ( w.state === 'minimized' ) {
			w.restore();
		}
		if ( w.state === 'fullscreen' ) {
			w.toggleFullscreen();
		}
		if ( w.state === 'maximized' ) {
			w.toggleMaximize();
		}
	}

	const rect = mgr._desktop.getBoundingClientRect();
	const auto = pickGridDimensions(
		eligible.length,
		rect.width,
		rect.height,
	);

	// Let plugins override the chosen grid. Validate the return: a
	// non-integer, non-positive, or under-sized grid would produce a
	// broken layout, so we silently fall back to the algorithmic
	// choice rather than trust a malformed value.
	const filtered = applyFilters<
		{ cols: number; rows: number },
		[ { windowCount: number; areaWidth: number; areaHeight: number } ]
	>(
		HOOKS.ARRANGE_TILE_DIMENSIONS,
		auto,
		{
			windowCount: eligible.length,
			areaWidth: rect.width,
			areaHeight: rect.height,
		},
	);
	const { cols, rows } = isValidGrid( filtered, eligible.length )
		? { cols: Math.floor( filtered.cols ), rows: Math.floor( filtered.rows ) }
		: auto;

	doAction( HOOKS.ARRANGE_TILE_STARTING, {
		windowCount: eligible.length,
		cols,
		rows,
	} );

	const padding = 16;
	const gap = 12;
	const cellWidth = Math.floor(
		( rect.width - padding * 2 - gap * ( cols - 1 ) ) / cols,
	);
	const cellHeight = Math.floor(
		( rect.height - padding * 2 - gap * ( rows - 1 ) ) / rows,
	);

	eligible.forEach( ( w, i ) => {
		const col = i % cols;
		const row = Math.floor( i / cols );
		w.element.style.left = `${ padding + col * ( cellWidth + gap ) }px`;
		w.element.style.top = `${ padding + row * ( cellHeight + gap ) }px`;
		w.element.style.width = `${ cellWidth }px`;
		w.element.style.height = `${ cellHeight }px`;
	} );

	const focused = mgr.getFocused();
	if ( focused ) {
		mgr.focus( focused );
	}

	document.dispatchEvent(
		new CustomEvent( 'desktop-mode-window-changed', {
			detail: { reason: 'tile' },
		} ),
	);

	doAction( HOOKS.ARRANGE_TILE_APPLIED, {
		windowCount: eligible.length,
		cols,
		rows,
	} );
}
