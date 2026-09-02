/**
 * OpenStation — Window arrangement algorithms.
 *
 * `cascade` and `tile` are the two "Arrange" commands exposed from the
 * admin-bar menu; `columns` and `focus` are what a workspace's
 * `layout` resolves to. All four touch every window on the active
 * desktop, so they sit outside the class body to keep the orchestrator
 * file readable. Snap config + grid validation live in sibling modules
 * (`snap.ts`, `geometry.ts`).
 *
 * Every one of them normalizes state first — restore before unwinding
 * fullscreen and maximize, in that order, because `restore()` returns
 * a window to whatever it was before it was minimized and that may
 * itself be maximized.
 */

import { applyFilters, doAction, HOOKS } from '../hooks';
import { workAreaRectOf } from '../work-area';
import type { Window } from '../window';
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

	// The work area: the cascade must not walk the last windows'
	// bottom edges under the dock pill.
	const rect = workAreaRectOf( mgr._desktop );
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
		// An arrangement is a placement of its own; a grid span the
		// window was carrying would put it straight back on its cells
		// at the next work-area change and silently undo this.
		w._gridSpan = null;
		w.element.style.left = `${ rect.x + padding + step * offset }px`;
		w.element.style.top = `${ rect.y + padding + step * offset }px`;
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
		new CustomEvent( 'os-window-changed', {
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

	// The work area — the grid covers what the user can reach, and
	// the bottom row stops above the dock pill.
	const rect = workAreaRectOf( mgr._desktop );
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
		// See cascade: the tile is the placement now.
		w._gridSpan = null;
		w.element.style.left = `${ rect.x + padding + col * ( cellWidth + gap ) }px`;
		w.element.style.top = `${ rect.y + padding + row * ( cellHeight + gap ) }px`;
		w.element.style.width = `${ cellWidth }px`;
		w.element.style.height = `${ cellHeight }px`;
	} );

	const focused = mgr.getFocused();
	if ( focused ) {
		mgr.focus( focused );
	}

	document.dispatchEvent(
		new CustomEvent( 'os-window-changed', {
			detail: { reason: 'tile' },
		} ),
	);

	doAction( HOOKS.ARRANGE_TILE_APPLIED, {
		windowCount: eligible.length,
		cols,
		rows,
	} );
}

/**
 * Windows on the active desktop, normalized so an arrangement can
 * actually place them.
 *
 * Shared by `columns` and `focus`. Returns an empty array when there
 * is nothing to arrange, which is the caller's cue to do nothing at
 * all rather than emit a starting/applied pair over no windows.
 */
function prepareForArrange( mgr: WindowManager ): Window[] {
	const eligible = mgr._stack.filter(
		( w ) => w.config.desktopId === mgr._activeDesktopId,
	);
	if ( eligible.length === 0 ) {
		return [];
	}
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
		// An arrangement is a placement of its own. A window already
		// `normal` passes through none of the state changes above, so
		// a grid span it was carrying would survive and put it straight
		// back on its cells at the next work-area change — a browser
		// resize undoing the arrangement a workspace just applied.
		w._gridSpan = null;
	}
	return eligible;
}

/**
 * Re-focus the previously focused window and tell the session saver
 * the geometry moved. The tail every arrangement shares.
 */
function settleArrange( mgr: WindowManager, reason: string ): void {
	const focused = mgr.getFocused();
	if ( focused ) {
		mgr.focus( focused );
	}
	document.dispatchEvent(
		new CustomEvent( 'os-window-changed', { detail: { reason } } ),
	);
}

/**
 * The most columns worth having.
 *
 * Past four, a column is narrower than an admin table's own minimum
 * width and every window grows a horizontal scrollbar — the
 * arrangement would be technically applied and practically useless.
 * Beyond the cap `columns` hands off to {@link tile}, which is the
 * honest answer for "more windows than fit side by side".
 */
const MAX_COLUMNS = 4;

/**
 * One full-height column per window, side by side across the work
 * area.
 *
 * The comparison shape: three lists you read across rather than one
 * you read down. What the Commerce workspace opens with, and what "Columns"
 * means in the workspace editor.
 */
export function columns( mgr: WindowManager ): void {
	const eligible = prepareForArrange( mgr );
	if ( eligible.length === 0 ) {
		return;
	}
	if ( eligible.length > MAX_COLUMNS ) {
		tile( mgr );
		return;
	}

	const cols = eligible.length;
	doAction( HOOKS.ARRANGE_COLUMNS_STARTING, {
		windowCount: eligible.length,
		cols,
	} );

	// The work area, not the desktop area: a full-height column must
	// stop above the dock pill rather than run under it.
	const rect = workAreaRectOf( mgr._desktop );
	const padding = 16;
	const gap = 12;
	const colWidth = Math.floor(
		( rect.width - padding * 2 - gap * ( cols - 1 ) ) / cols,
	);
	const colHeight = Math.floor( rect.height - padding * 2 );

	eligible.forEach( ( w, i ) => {
		w.element.style.left = `${ rect.x + padding + i * ( colWidth + gap ) }px`;
		w.element.style.top = `${ rect.y + padding }px`;
		w.element.style.width = `${ colWidth }px`;
		w.element.style.height = `${ colHeight }px`;
	} );

	settleArrange( mgr, 'columns' );
	doAction( HOOKS.ARRANGE_COLUMNS_APPLIED, {
		windowCount: eligible.length,
		cols,
	} );
}

/** The lead window's share of the work area's width, before filtering. */
const FOCUS_SPLIT = 0.64;

/**
 * One window leading, the rest stacked in the margin.
 *
 * The writing shape: the page being worked on takes roughly two
 * thirds, and everything else stays visible without competing for
 * attention. What the Publishing workspace opens with.
 *
 * The lead is the FOCUSED window when one is on this desktop, not the
 * first in the stack — re-applying the layout after clicking into the
 * reference list would otherwise demote the thing the user just
 * reached for. With a single window this degrades to "maximize
 * politely", which is the right answer for a desk holding one page.
 */
export function focus( mgr: WindowManager ): void {
	const eligible = prepareForArrange( mgr );
	if ( eligible.length === 0 ) {
		return;
	}

	const rect = workAreaRectOf( mgr._desktop );
	const filtered = applyFilters<
		number,
		[ { windowCount: number; areaWidth: number; areaHeight: number } ]
	>( HOOKS.ARRANGE_FOCUS_SPLIT, FOCUS_SPLIT, {
		windowCount: eligible.length,
		areaWidth: rect.width,
		areaHeight: rect.height,
	} );
	// A lead window that leaves no room for the stack — or no room for
	// itself — is not an arrangement. Anything outside the band falls
	// back rather than being clamped, so a plugin returning nonsense
	// gets the shipped layout instead of a silently different one.
	const split =
		Number.isFinite( filtered ) && filtered >= 0.3 && filtered <= 0.9
			? filtered
			: FOCUS_SPLIT;

	doAction( HOOKS.ARRANGE_FOCUS_STARTING, {
		windowCount: eligible.length,
		split,
	} );

	const padding = 16;
	const gap = 12;
	const areaWidth = rect.width - padding * 2;
	const areaHeight = rect.height - padding * 2;

	const current = mgr.getFocused();
	const leadIndex =
		current && eligible.includes( current ) ? eligible.indexOf( current ) : 0;
	const lead = eligible[ leadIndex ];
	const rest = eligible.filter( ( _, i ) => i !== leadIndex );

	// Alone on the desk, the lead takes the whole work area — there is
	// no margin to reserve for a stack that does not exist.
	const leadWidth =
		rest.length === 0 ? areaWidth : Math.floor( areaWidth * split );
	lead.element.style.left = `${ rect.x + padding }px`;
	lead.element.style.top = `${ rect.y + padding }px`;
	lead.element.style.width = `${ leadWidth }px`;
	lead.element.style.height = `${ areaHeight }px`;

	if ( rest.length > 0 ) {
		const stackX = rect.x + padding + leadWidth + gap;
		const stackWidth = areaWidth - leadWidth - gap;
		const stackHeight = Math.floor(
			( areaHeight - gap * ( rest.length - 1 ) ) / rest.length,
		);
		rest.forEach( ( w, i ) => {
			w.element.style.left = `${ stackX }px`;
			w.element.style.top = `${ rect.y + padding + i * ( stackHeight + gap ) }px`;
			w.element.style.width = `${ stackWidth }px`;
			w.element.style.height = `${ stackHeight }px`;
		} );
	}

	// The lead is the point of this arrangement, so it ends on top —
	// whether or not it was the window that had focus on the way in.
	mgr.focus( lead );
	document.dispatchEvent(
		new CustomEvent( 'os-window-changed', { detail: { reason: 'focus' } } ),
	);

	doAction( HOOKS.ARRANGE_FOCUS_APPLIED, {
		windowCount: eligible.length,
		split,
	} );
}
