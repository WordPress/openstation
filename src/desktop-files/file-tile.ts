/**
 * Desktop Mode — File-tile renderer.
 *
 * One tile = one placement. Renders an absolutely-positioned
 * button with icon + label + optional preview. Tile DOM is
 * intentionally simple so that plugins can decorate it via the
 * `desktop-mode.files.tile-rendered` action without fighting a
 * deep render tree.
 *
 * Tile contract (data attributes used by hit-testing /
 * decoration / tests):
 *
 *   data-placement-id  Numeric placement id.
 *   data-file-type     File-type slug.
 *   data-file-ref      Entity reference.
 *   data-folder-id     Folder this tile lives in (0 for root).
 *
 * @since 0.9.0
 */

import { applyFilters, doAction } from '../hooks';
import { resolve as resolveFileType } from './registry';
import { openFile } from './open';
import type { RestPlacementShape } from './rest';

/** CSS class on every tile. */
export const TILE_CLASS = 'desktop-mode-file-tile';

/** Build the DOM for a single placement. */
export function buildTile( placement: RestPlacementShape, folderId: number ): HTMLElement {
	const file = resolveFileType( placement.file );

	const tile = document.createElement( 'button' );
	tile.type = 'button';
	tile.className = applyFilters< string, [ RestPlacementShape ] >(
		'desktop-mode.files.tile-class',
		TILE_CLASS,
		placement,
	);
	tile.dataset.placementId = String( placement.id );
	tile.dataset.fileType = placement.file.type;
	tile.dataset.fileRef = placement.file.ref;
	tile.dataset.folderId = String( folderId );
	tile.style.position = 'absolute';
	tile.style.left = `${ placement.x }px`;
	tile.style.top = `${ placement.y }px`;
	tile.setAttribute( 'role', 'listitem' );
	tile.setAttribute( 'aria-label', file.title() );
	if ( ! placement.file.exists ) {
		tile.classList.add( `${ TILE_CLASS }--missing` );
	}

	const visual = document.createElement( 'span' );
	visual.className = `${ TILE_CLASS }__visual`;
	const previewUrl = file.previewUrl();
	if ( previewUrl ) {
		const img = document.createElement( 'img' );
		img.src = previewUrl;
		img.alt = '';
		img.className = `${ TILE_CLASS }__preview`;
		visual.appendChild( img );
	} else {
		const icon = document.createElement( 'span' );
		icon.className = `${ TILE_CLASS }__icon dashicons ${ sanitizeClass( file.icon() ) }`;
		icon.setAttribute( 'aria-hidden', 'true' );
		visual.appendChild( icon );
	}
	tile.appendChild( visual );

	const label = document.createElement( 'span' );
	label.className = `${ TILE_CLASS }__label`;
	label.textContent = file.title();
	tile.appendChild( label );

	// Plugin extension point: custom DOM injected at the end of the
	// tile. Filters return null when they want to skip; non-Element
	// returns are ignored.
	const extra = applyFilters< Element | null, [ RestPlacementShape ] >(
		'desktop-mode.files.tile-element',
		null,
		placement,
	);
	if ( extra instanceof Element ) {
		tile.appendChild( extra );
	}

	tile.addEventListener( 'dblclick', ( e ) => {
		e.preventDefault();
		e.stopPropagation();
		void openFile( file );
	} );

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

/** Strip anything that isn't a valid CSS class character. */
function sanitizeClass( raw: string ): string {
	return raw.replace( /[^a-zA-Z0-9_-]/g, '' );
}
