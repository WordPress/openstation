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
import { showToast } from '../toast';
import { applyTileEntryStagger } from '../utils';
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
	if ( placement.accessGated ) {
		// Recipient sees the icon but lacks read access on the
		// underlying entity. Dim it and label it; the click
		// handler below short-circuits the opener with a toast.
		tile.classList.add( `${ TILE_CLASS }--access-gated` );
		tile.title = 'You don’t have permission to open this — ask the folder owner for access.';
		tile.setAttribute( 'aria-disabled', 'true' );
	}

	const visual = document.createElement( 'span' );
	visual.className = `${ TILE_CLASS }__visual`;
	const previewUrl = file.previewUrl();
	// Per-placement icon override on `meta.iconUrl` — set by the
	// favicon resolver for `link` placements, but generic enough
	// that any plugin can attach a custom icon (URL, data URI) per
	// placement without subclassing the file type.
	const metaIconUrl =
		placement.meta && typeof ( placement.meta as { iconUrl?: unknown } ).iconUrl === 'string'
			? ( placement.meta as { iconUrl: string } ).iconUrl.trim()
			: '';
	if ( previewUrl ) {
		const img = document.createElement( 'img' );
		img.src = previewUrl;
		img.alt = '';
		img.className = `${ TILE_CLASS }__preview`;
		// `<img>` is `draggable=true` by default — leaving it as
		// such lets the browser intercept pointerdown with a native
		// HTML5 image-drag, which silently kills the DragManager's
		// pointer-event-driven tile rearrange.
		img.draggable = false;
		visual.appendChild( img );
	} else {
		// Single canonical dispatch — `renderIcon` handles every shape
		// the icon can take: dashicons class, http(s) URL,
		// `data:image/svg+xml;base64,…` or `data:image/png;base64,…`
		// data URI, or letter-badge fallback. `meta.iconUrl` wins
		// over `file.icon()` so a per-placement override (e.g. a
		// resolved favicon) shows in place of the file type's
		// generic glyph.
		const iconSource = '' !== metaIconUrl ? metaIconUrl : file.icon();
		const icon = renderIcon( iconSource, {
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

	if ( placement.accessGated ) {
		const lock = document.createElement( 'span' );
		lock.className = `${ TILE_CLASS }__lock dashicons dashicons-lock`;
		lock.setAttribute( 'aria-hidden', 'true' );
		tile.appendChild( lock );
	}

	applyTileEntryStagger( tile );

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
