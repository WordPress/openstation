/**
 * Desktop Mode — placement → tile adapter.
 *
 * Thin layer over the generic `buildTileFromSpec()` renderer in
 * `tile-spec.ts`. Converts a `RestPlacementShape` into a `TileSpec`,
 * paints it, and adds the desktop-files-specific behavior:
 *
 *   - Double-click → `openFile()` (the desktop opens; folder
 *     windows open child folders; My WordPress windows don't run
 *     through this path).
 *   - Per-placement `meta.iconUrl` / `meta.name` overrides.
 *   - A lock badge + access-gated toast when the recipient lacks
 *     read permission on the underlying entity.
 *   - Fires the internal `desktop-mode.files.tile-rendered` action
 *     consumed by `share-menu-items.ts` for the shared-folder
 *     badge overlay.
 *
 * The canonical tile chrome (DOM shape, status ribbon, drag-out
 * helper) lives in `tile-spec.ts`. Adding a feature there lights
 * it up on every surface — desktop, folders, My WordPress, plugin
 * windows — without forking the renderer.
 *
 * @since 0.9.0
 */

import { doAction } from '../hooks';
import { resolve as resolveFileType } from './registry';
import { openFile } from './open';
import { showToast } from '../toast';
import type { RestPlacementShape } from './rest';
import {
	buildTileFromSpec,
	TILE_CLASS,
	type TileSpec,
} from './tile-spec';

export { TILE_CLASS };

/**
 * Convert a placement into the generic spec the unified renderer
 * consumes. Picks up per-placement `meta.iconUrl` / `meta.name`
 * overrides + the file-type defaults.
 */
function placementToSpec(
	placement: RestPlacementShape,
	folderId: number,
): TileSpec {
	const file = resolveFileType( placement.file );
	const previewUrl = file.previewUrl();

	const metaName =
		placement.meta && typeof ( placement.meta as { name?: unknown } ).name === 'string'
			? ( placement.meta as { name: string } ).name.trim()
			: '';
	const label = metaName !== '' ? metaName : file.title();

	const metaIconUrl =
		placement.meta && typeof ( placement.meta as { iconUrl?: unknown } ).iconUrl === 'string'
			? ( placement.meta as { iconUrl: string } ).iconUrl.trim()
			: '';

	return {
		type: placement.file.type,
		ref: placement.file.ref,
		label,
		// Preview wins over icon (matches the previous behavior).
		thumbnail: previewUrl || undefined,
		icon: previewUrl ? undefined : ( metaIconUrl || file.icon() ),
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

/** Build a `<wpd-tile>` for a single placement. */
export function buildTile(
	placement: RestPlacementShape,
	folderId: number,
): HTMLElement {
	const file = resolveFileType( placement.file );
	const tile = buildTileFromSpec( placementToSpec( placement, folderId ) );
	// Ensure connectedCallback fires (initializes the tile's DOM)
	// before the internal subscriber (`share-menu-items.ts`)
	// decorates it on the action below. Layers re-parent the tile
	// to the live grid after this — re-connecting is harmless.
	if ( ! tile.isConnected ) {
		const detachedRoot = document.createElement( 'div' );
		detachedRoot.appendChild( tile );
	}

	tile.addEventListener( 'dblclick', ( e ) => {
		e.preventDefault();
		e.stopPropagation();
		if ( placement.accessGated ) {
			showToast( {
				message:
					`You don’t have permission to open "${ placement.file.title || file.title() }". ` +
					'Ask the folder owner if you need access to this item.',
				duration: 6000,
			} );
			return;
		}
		void openFile( file, {
			placement: {
				id: placement.id,
				x: placement.x,
				y: placement.y,
				meta: placement.meta,
			},
		} );
	} );

	// Internal consumer: `share-menu-items.ts` paints the shared-
	// folder badge on every render. Kept on the placement-shaped
	// signature so that subscriber doesn't have to re-derive the
	// placement from the generic spec.
	doAction( 'desktop-mode.files.tile-rendered', { tile, placement } );
	return tile;
}

/**
 * Update an existing tile's position in place. Called by the
 * drag handler so we don't rebuild the whole grid on every
 * pointermove.
 */
export function setTilePosition( tile: HTMLElement, x: number, y: number ): void {
	tile.style.left = `${ x }px`;
	tile.style.top = `${ y }px`;
}
