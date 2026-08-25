/**
 * OpenStation — synthetic placements.
 *
 * A "synthetic" placement is a desktop tile with no row behind it:
 * an admin menu or a launcher the user put on the wallpaper.
 * `nav/desktop-sync.ts` mints them into the store with deterministic
 * negative ids, so any REST write aimed at one would 404
 * (`/files/placements/(?P<id>\d+)` only matches positive integers).
 *
 * Extracted from `layer.ts` so the tile-action builder can share
 * these predicates without importing the layer — the layer imports
 * the builder, and a cycle between the two would be a real hazard
 * given how much module-level state `layer.ts` sets up.
 */

import { setRegion } from '../nav/config';
import type { RestPlacementShape } from './rest';

/**
 * If `placement` is a synthesized shortcut from a promoted dock item,
 * return the source dock-item id. Returns `null` for real placements.
 *
 * Marker key matches the one written by `nav/desktop-sync.ts`.
 */
export function readSynthSource( placement: RestPlacementShape ): string | null {
	const meta = placement.meta;
	if ( ! meta || typeof meta !== 'object' ) {
		return null;
	}
	const v = ( meta as Record< string, unknown > ).__synthFromDockItem;
	return typeof v === 'string' && v !== '' ? v : null;
}

/**
 * Whether `placement` is a synthetic (no DB row) one. Two signals:
 *   - The `__synthFromDockItem` meta marker — definitive when present.
 *   - A non-positive id — see the module header for why those can
 *     never round-trip through REST either.
 *
 * Used to gate every REST write against a placement.
 */
export function isSyntheticPlacement( placement: RestPlacementShape ): boolean {
	return placement.id <= 0 || readSynthSource( placement ) !== null;
}

/**
 * Take items off the wallpaper.
 *
 * Removes the desktop region from each item's placement, leaving
 * whatever else it had: an item on both surfaces stays on its rail,
 * and a desktop-only one becomes hidden. The desktop sync drops the
 * placement on the next tick.
 *
 * Accepts several ids at once so hiding a multi-selection is a single
 * settings write — one round-trip, one re-render, instead of N of each
 * racing the sync subscription.
 */
export function hideFromDesktop( ids: readonly string[] ): void {
	if ( ids.length === 0 ) {
		return;
	}
	setRegion( ids, 'desktop', false );
}
