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
import { renderIcon } from '../icon';
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
	tile.setAttribute(
		'aria-label',
		(
			placement.meta &&
			typeof ( placement.meta as { name?: unknown } ).name === 'string' &&
			( ( placement.meta as { name: string } ).name.trim() !== '' )
		)
			? ( placement.meta as { name: string } ).name.trim()
			: file.title(),
	);
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
		// Single canonical dispatch — `renderIcon` handles every shape
		// `file.icon()` can take: dashicons class, http(s) URL,
		// `data:image/svg+xml;base64,…` data URI, or letter-badge
		// fallback. Pre-0.8.2 the file-tile renderer (like the
		// wallpaper-icon renderer it shipped alongside) glued every
		// non-empty value onto a `dashicons` class — file-type icons
		// declared as URLs or data URIs rendered as broken empty
		// squares.
		const icon = renderIcon( file.icon(), {
			title: file.title(),
			className: `${ TILE_CLASS }__icon`,
		} );
		visual.appendChild( icon );
	}
	tile.appendChild( visual );

	const label = document.createElement( 'span' );
	label.className = `${ TILE_CLASS }__label`;
	// Per-placement name override — set by the wallpaper menu's
	// "New web link / window" flow so two tiles pointing at the same
	// URL can carry different labels. Generic enough that any
	// type/plugin can opt in by writing `meta.name` on the placement.
	const metaName =
		placement.meta && typeof ( placement.meta as { name?: unknown } ).name === 'string'
			? ( placement.meta as { name: string } ).name.trim()
			: '';
	label.textContent = metaName !== '' ? metaName : file.title();
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
		void openFile( file, {
			placement: {
				id: placement.id,
				x: placement.x,
				y: placement.y,
				meta: placement.meta,
			},
		} );
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
