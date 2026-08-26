/**
 * OpenStation — placement → tile adapter.
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
 *   - Fires the internal `os.files.tile-rendered` action
 *     consumed by `share-menu-items.ts` for the shared-folder
 *     badge overlay.
 *
 * The canonical tile chrome (DOM shape, status ribbon, drag-out
 * helper) lives in `tile-spec.ts`. Adding a feature there lights
 * it up on every surface — desktop, folders, My WordPress, plugin
 * windows — without forking the renderer.
 */

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

/**
 * Visible label for a placement — the per-placement `meta.name`
 * override when present, the file's own title otherwise.
 *
 * Exported for the layer's fast-path repaints: they reuse tile DOM
 * instead of rebuilding, so they re-derive the label with this same
 * rule and patch the `<os-tile>` `label` attribute in place.
 */
export function placementLabel( placement: RestPlacementShape ): string {
	const metaName =
		placement.meta && typeof ( placement.meta as { name?: unknown } ).name === 'string'
			? ( placement.meta as { name: string } ).name.trim()
			: '';
	return metaName !== '' ? metaName : resolveFileType( placement.file ).title();
}

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

	const label = placementLabel( placement );

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
		// Precedence when no preview exists:
		//   live art override         (a rail said so about this tile
		//                              JUST NOW — the Trash drawn full
		//                              because it is holding something)
		//   → per-placement `meta.iconUrl`  (the user/plugin said so
		//                                  about THIS tile)
		//   → desktop-theme FILE_* slot   (the theme said so about
		//                                  this KIND of tile)
		//   → the file type's own icon.
		// The per-placement override outranks the theme on purpose:
		// it is specific, deliberate, and about one object.
		//
		// The art override leads because it is the only one describing
		// the object's current STATE rather than its identity, and
		// because `setArt` is idempotent: it stores the override and
		// paints the nodes that exist at the time. A tile built later
		// has to come and get it, exactly as `Dock.appendSystemItem`
		// re-applies its own overrides. Without this the wallpaper bin
		// is drawn empty forever, however full it is.
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

/** Build a `<os-tile>` for a single placement. */
export function buildTile(
	placement: RestPlacementShape,
	folderId: number,
): HTMLElement {
	const tile = buildTileFromSpec( placementToSpec( placement, folderId ) );

	// Back-compat: placement-shaped class filter. Documented in
	// docs/files-on-desktop.md; third-party plugins rely
	// on the exact filter name + the `TILE_CLASS` default input +
	// the `RestPlacementShape` signature. The `<os-tile>` host
	// re-asserts `TILE_CLASS` in `_paint()`, so any extra classes
	// the filter returns ride alongside it.
	const classFiltered = applyFilters< string, [ RestPlacementShape ] >(
		'os.files.tile-class',
		TILE_CLASS,
		placement,
	);
	if ( classFiltered && classFiltered !== TILE_CLASS ) {
		tile.className = classFiltered;
	}

	// Back-compat: placement-shaped extra-element filter. Plugins
	// returning a non-Element get ignored (same as before).
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
		// Re-read the live placement — the layer's fast-path repaints
		// reuse this tile's DOM without re-wiring, so the captured
		// `placement` can be stale by now (an in-place rename would
		// otherwise leak the old title into the opened window).
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

	// Internal consumer: `share-menu-items.ts` paints the shared-
	// folder badge on every render. Kept on the placement-shaped
	// signature so that subscriber doesn't have to re-derive the
	// placement from the generic spec.
	doAction( 'os.files.tile-rendered', { tile, placement } );
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
