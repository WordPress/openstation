import { applyFilters, doAction, HOOKS } from '../hooks';
import { isValidCellSize } from './geometry';
import type { WindowManager } from './index';

export const SNAP_STORAGE_KEY = 'desktop-mode-snap-to-grid';

export function loadSnapEnabled(): boolean {
	try {
		return window.localStorage.getItem( SNAP_STORAGE_KEY ) === '1';
	} catch {
		return false;
	}
}

export function setSnapEnabled( mgr: WindowManager, enabled: boolean ): void {
	if ( mgr._snapEnabled === enabled ) {
		return;
	}
	mgr._snapEnabled = enabled;
	try {
		window.localStorage.setItem( SNAP_STORAGE_KEY, enabled ? '1' : '0' );
	} catch {

	}
	doAction( HOOKS.ARRANGE_SNAP_CHANGED, { enabled } );
}

export function getSnapConfig(
	mgr: WindowManager,
): { enabled: boolean; cellWidth: number; cellHeight: number } {
	if ( ! mgr._snapEnabled ) {
		return { enabled: false, cellWidth: 0, cellHeight: 0 };
	}
	const rect = mgr._desktop.getBoundingClientRect();

	const targetCols = rect.width >= rect.height ? 12 : 8;
	const auto = {
		cellWidth: Math.max( 40, Math.round( rect.width / targetCols ) ),
		cellHeight: Math.max(
			40,
			Math.round( rect.height / Math.round( targetCols * 0.66 ) ),
		),
	};

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
