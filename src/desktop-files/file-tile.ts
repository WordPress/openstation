import { resolveThemedIcon } from '../desktop-themes/icons';
import { slotForFileType } from '../desktop-themes/slots';
import { getIconArt } from '../desktop-icons';
import { applyFilters, doAction } from '../hooks';
import { resolve as resolveFileType } from './registry';
import { openFile } from './open';
import { showToast } from '../toast';
import { currentPlacement } from './store';
import type { RestPlacementShape } from './rest';
import {
	buildTileFromSpec,
	TILE_CLASS,
	type TileSpec,
} from './tile-spec';

export { TILE_CLASS };

export function placementLabel( placement: RestPlacementShape ): string {
	const metaName =
		placement.meta && typeof ( placement.meta as { name?: unknown } ).name === 'string'
			? ( placement.meta as { name: string } ).name.trim()
			: '';
	return metaName !== '' ? metaName : resolveFileType( placement.file ).title();
}

function placementToSpec(
	placement: RestPlacementShape,
	folderId: number,
): TileSpec {
	const file = resolveFileType( placement.file );
	const previewUrl = file.previewUrl();

	const label = placementLabel( placement );

	const metaIconUrl =
		placement.meta && typeof ( placement.meta as { iconUrl?: unknown } ).iconUrl === 'string'
			? ( placement.meta as { iconUrl: string } ).iconUrl.trim()
			: '';

	return {
		type: placement.file.type,
		ref: placement.file.ref,
		label,

		thumbnail: previewUrl || undefined,

		icon: previewUrl
			? undefined
			: ( getIconArt( placement.file.ref ) ||
				metaIconUrl ||
				resolveThemedIcon( slotForFileType( placement.file.type ) ) ||
				file.icon() ),
		x: placement.x,
		y: placement.y,
		dataset: {
			placementId: placement.id,
			folderId,
		},
		meta: placement.meta as Record< string, unknown > | undefined,
		missing: ! placement.file.exists,
		accessGated: Boolean( placement.accessGated ),
		ariaLabel: label,
	};
}

export function buildTile(
	placement: RestPlacementShape,
	folderId: number,
): HTMLElement {
	const tile = buildTileFromSpec( placementToSpec( placement, folderId ) );

	const classFiltered = applyFilters< string, [ RestPlacementShape ] >(
		'os.files.tile-class',
		TILE_CLASS,
		placement,
	);
	if ( classFiltered && classFiltered !== TILE_CLASS ) {
		tile.className = classFiltered;
	}

	const extra = applyFilters< Element | null, [ RestPlacementShape ] >(
		'os.files.tile-element',
		null,
		placement,
	);
	if ( extra instanceof Element ) {
		tile.appendChild( extra );
	}

	tile.addEventListener( 'dblclick', ( e ) => {
		e.preventDefault();
		e.stopPropagation();

		const live = currentPlacement( placement );
		const file = resolveFileType( live.file );
		if ( live.accessGated ) {
			showToast( {
				message:
					`You don’t have permission to open "${ live.file.title || file.title() }". ` +
					'Ask the folder owner if you need access to this item.',
				duration: 6000,
			} );
			return;
		}
		void openFile( file, {
			placement: {
				id: live.id,
				x: live.x,
				y: live.y,
				meta: live.meta,
			},
		} );
	} );

	doAction( 'os.files.tile-rendered', { tile, placement } );
	return tile;
}

export function setTilePosition( tile: HTMLElement, x: number, y: number ): void {
	tile.style.left = `${ x }px`;
	tile.style.top = `${ y }px`;
}
