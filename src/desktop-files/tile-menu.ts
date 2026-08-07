/**
 * OpenStation — File-tile right-click context menu.
 *
 * Sister of the wallpaper context menu, scoped to a placement — or,
 * since multi-selection, to the placements the user currently holds.
 * The built-in item set lives in `tile-actions.ts`; plugin authors
 * extend it via the `os.files.tile-menu` filter, unchanged.
 *
 * The DOM is built by the shared `openActionMenu` (deferred behind
 * the shell-overlays loader, dismissable, viewport-clamped). This
 * module keeps the placement-shaped entry points and the long-
 * standing `os.files.tile-menu.opened` / `.closed` actions, which
 * plugins subscribe to.
 */

import { applyFilters, doAction } from '../hooks';
import {
	closeActionMenu,
	isActionMenuOpen,
	openActionMenu,
} from '../selection/menu';
import type { SelectionAction } from '../selection/actions';
import type { RestPlacementShape } from './rest';

/**
 * One entry in a file-tile menu.
 *
 * The multi-selection fields (`multi`, `multiId`, `bulkLabel`,
 * `bulk`) are optional and default to single-item-only: an entry
 * added by a plugin keeps behaving exactly as it did, and appears
 * only when one tile is selected, until it opts in.
 *
 * @public
 */
export type TileMenuItem = SelectionAction< RestPlacementShape >;

export function isTileMenuOpen(): boolean {
	return isActionMenuOpen();
}

export function closeTileMenu(): void {
	closeActionMenu();
}

export interface OpenTileMenuOptions {
	placement: RestPlacementShape;
	items: TileMenuItem[];
}

/**
 * Open the tile context menu for ONE placement, applying the
 * `os.files.tile-menu` filter to `items` first.
 *
 * The layer no longer routes through here — it resolves the actions
 * for the whole selection (which applies the filter per item) and
 * calls {@link openPlacementActionMenu}. This entry point stays for
 * plugins and tests that build a menu for a single placement.
 */
export function openTileMenu(
	pos: { x: number; y: number },
	{ placement, items }: OpenTileMenuOptions,
): void {
	const list = applyFilters< TileMenuItem[], [ RestPlacementShape ] >(
		'os.files.tile-menu',
		items.slice(),
		placement,
	);
	const resolved = Array.isArray( list ) ? list : items;
	openPlacementActionMenu( pos, resolved, {
		placementIds: [ placement.id ],
	} );
}

export interface PlacementActionMenuContext {
	/** Placements the menu acts on. Drives the `opened` action payload. */
	placementIds: number[];
}

/**
 * Open a menu for an already-resolved action list.
 *
 * "Already resolved" means the `os.files.tile-menu` filter has run
 * (per item) and, for a multi-selection, `resolveCommonActions` has
 * intersected the results. Applying the filter again here would
 * double every entry a plugin pushes.
 */
export function openPlacementActionMenu(
	pos: { x: number; y: number },
	actions: TileMenuItem[],
	ctx: PlacementActionMenuContext,
): void {
	const sorted = actions.slice().sort( ( a, b ) => {
		const sa = typeof a.sort === 'number' ? a.sort : 100;
		const sb = typeof b.sort === 'number' ? b.sort : 100;
		if ( sa !== sb ) {
			return sa - sb;
		}
		return a.label.localeCompare( b.label );
	} );
	if ( sorted.length === 0 ) {
		return;
	}

	openActionMenu( pos, {
		actions: sorted,
		scope: 'files.tile',
		dataset: {
			// Single-selection menus keep the exact attribute the old
			// implementation set — tests and plugin CSS select on it.
			placementId: String( ctx.placementIds[ 0 ] ?? '' ),
			placementIds: ctx.placementIds.join( ',' ),
		},
		onOpened: ( ids ) => {
			doAction( 'os.files.tile-menu.opened', {
				placementId: ctx.placementIds[ 0 ],
				placementIds: ctx.placementIds.slice(),
				items: ids,
			} );
		},
		onClosed: () => {
			doAction( 'os.files.tile-menu.closed', {} );
		},
	} );
}
