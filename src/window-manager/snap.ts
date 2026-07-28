/**
 * Desktop Mode — Snap-to-grid.
 *
 * Optional drag / resize quantization. State lives on the window
 * manager and persists to localStorage so the choice survives reloads.
 * Windows read snap state via `getSnapConfig` which the manager wires
 * onto each new window at construction.
 */

import { applyFilters, doAction, HOOKS } from '../hooks';
import { isValidCellSize } from './geometry';
import type { WindowManager } from './index';

/** Storage key for the snap-to-grid preference. */
export const SNAP_STORAGE_KEY = 'desktop-mode-snap-to-grid';

/** Read the persisted snap-enabled flag from localStorage at boot. */
export function loadSnapEnabled(): boolean {
	try {
		return window.localStorage.getItem( SNAP_STORAGE_KEY ) === '1';
	} catch {
		return false;
	}
}

/**
 * Toggle (or set) the snap-to-grid preference. Persisted via
 * localStorage and broadcast through `ARRANGE_SNAP_CHANGED` so any
 * external UI mirroring the state stays in sync.
 */
export function setSnapEnabled( mgr: WindowManager, enabled: boolean ): void {
	if ( mgr._snapEnabled === enabled ) {
		return;
	}
	mgr._snapEnabled = enabled;
	try {
		window.localStorage.setItem( SNAP_STORAGE_KEY, enabled ? '1' : '0' );
	} catch {
		/* private mode / storage unavailable — silently degrade */
	}
	doAction( HOOKS.ARRANGE_SNAP_CHANGED, { enabled } );
}

/**
 * Resolve the live snap config for a window's drag/resize loop. Cell
 * sizes scale with the desktop area so a small viewport gets a smaller
 * grid (~12 cols × 8 rows) and a 4K monitor gets a proportionally
 * finer one.
 *
 * Each call hits `getBoundingClientRect`, so callers should cache the
 * result for the duration of a single drag rather than calling once
 * per pointermove.
 */
export function getSnapConfig(
	mgr: WindowManager,
): { enabled: boolean; cellWidth: number; cellHeight: number } {
	if ( ! mgr._snapEnabled ) {
		return { enabled: false, cellWidth: 0, cellHeight: 0 };
	}
	const rect = mgr._desktop.getBoundingClientRect();
	// Aim for roughly 12 columns on landscape, 8 on portrait. Clamp to
	// reasonable bounds so a 320 px sidebar doesn't produce 27-pixel
	// cells.
	const targetCols = rect.width >= rect.height ? 12 : 8;
	const auto = {
		cellWidth: Math.max( 40, Math.round( rect.width / targetCols ) ),
		cellHeight: Math.max(
			40,
			Math.round( rect.height / Math.round( targetCols * 0.66 ) ),
		),
	};

	// Filter — plugins can swap in a custom grid (fixed Tetris blocks,
	// golden-ratio cells, etc.). A non-positive return is rejected;
	// we'd rather silently use the default than produce divide-by-zero
	// math downstream.
	const filtered = applyFilters<
		{ cellWidth: number; cellHeight: number },
		[ { areaWidth: number; areaHeight: number } ]
	>(
		HOOKS.ARRANGE_SNAP_CELL_SIZE,
		auto,
		{ areaWidth: rect.width, areaHeight: rect.height },
	);
	const { cellWidth, cellHeight } = isValidCellSize( filtered )
		? filtered
		: auto;

	return { enabled: true, cellWidth, cellHeight };
}
