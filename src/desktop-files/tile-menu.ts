import { applyFilters, doAction } from '../hooks';
import {
	closeActionMenu,
	isActionMenuOpen,
	openActionMenu,
} from '../selection/menu';
import type { SelectionAction } from '../selection/actions';
import type { RestPlacementShape } from './rest';

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

	placementIds: number[];
}

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
