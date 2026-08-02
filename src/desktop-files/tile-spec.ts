/**
 * Desktop Mode — generic tile spec + renderer.
 *
 * One canonical `<button class="desktop-mode-file-tile">` everywhere
 * a tile shows up — desktop wallpaper, folder windows, the My
 * WordPress sections (Posts, Pages, Users, Media, drill-in usage),
 * and any plugin surface that wants the same visual chrome.
 *
 * The function is intentionally pure DOM: it returns a button with
 * the right children + data-* attributes + status ribbon, but
 * doesn't wire click / dblclick / pointerdown. Callers attach the
 * behavior they need (open vs select, navigate vs single-click,
 * drag-out via `attachTileDragOut`). That split is the whole point
 * — it's what lets My WordPress's "click to select" coexist with
 * the desktop's "double-click to open" without forking the renderer.
 *
 * The legacy `buildTile(placement, folderId)` in `file-tile.ts`
 * keeps its placement-specific contract and now sits on top of
 * this generic renderer via a `placementToSpec()` adapter so the
 * `desktop-mode.files.tile-*` hook surface is unchanged for plugin
 * authors.
 */

import { TILE_CLASS, getDragManager } from '../ui/components/wpd-tile/wpd-tile';
import { applyFilters } from '../hooks';
import type { ShortcutDragData } from './drag-payloads';

// Re-export so existing consumers (`file-tile.ts`, downstream) keep
// pulling the canonical class from the desktop-files entry without
// caring that the source moved into the component.
export { TILE_CLASS };

/**
 * Status-ribbon discriminators we recognize. Any string is accepted
 * at runtime — callers pass the raw post status — but only these
 * four light up a ribbon (everything else is treated as "no ribbon").
 *
 * @public
 */
export type TileStatus = 'draft' | 'pending' | 'private' | 'future' | string;

/**
 * Generic tile-render input. The renderer reads only what it
 * needs; callers can leave most fields empty and still get the
 * canonical visual chrome.
 *
 * @public
 */
export interface TileSpec {
	/** File-type slug — `'post'`, `'user'`, `'attachment'`, … */
	type: string;
	/** Opaque entity reference (post id as string, etc.). */
	ref: string;
	/** Visible label. */
	label: string;
	/** Dashicon class, http(s) URL, or data: URI. Ignored if `thumbnail` is set. */
	icon?: string;
	/** Paint the icon inside the compact web/monitor frame. */
	favicon?: boolean;
	/**
	 * Preview image URL (replaces the icon for media tiles + the
	 * desktop link favicon). Renders as `<img class="…__preview">`.
	 */
	thumbnail?: string;
	/**
	 * Layout role:
	 *   - `'entry'`  — leaf entity (post, user, media). Default.
	 *   - `'folder'` — folder/section tile (different highlight).
	 *
	 * Maps to a class modifier the desktop / My WordPress CSS reads.
	 */
	role?: 'folder' | 'entry';
	/**
	 * WordPress post status — surfaces as the diagonal corner
	 * ribbon (`Draft` / `Pending` / `Private` / `Scheduled`) on
	 * non-`publish` values. Omit / pass `'publish'` for no ribbon.
	 *
	 * The ribbon visibility is also gated by the per-user
	 * `showPostStatusRibbons` OS setting — callers don't need to
	 * check it themselves, the renderer does.
	 */
	status?: TileStatus;
	/**
	 * Absolute (x, y) for canvas-positioned surfaces (desktop,
	 * folder windows, My WordPress Posts/Pages canvas). Omit for
	 * flow layouts (My WordPress Media grid, drill-in usage grid).
	 */
	x?: number;
	y?: number;
	/**
	 * Extra data-* attributes — e.g. `placementId` / `folderId`
	 * for desktop files, `postId` / `mediaId` for My WordPress.
	 * Keys are coerced to kebab-case data attribute names.
	 */
	dataset?: Record< string, string | number | undefined >;
	/**
	 * Free-form metadata available to decoration hooks. Mirrors
	 * `placement.meta` from the desktop-files contract.
	 */
	meta?: Record< string, unknown >;
	/** Extra class names appended to the canonical `TILE_CLASS`. */
	extraClasses?: string[];
	/**
	 * Optional `aria-label` override. Falls back to `label`.
	 */
	ariaLabel?: string;
	/**
	 * Visual signal that the underlying entity has been removed —
	 * mirrors the `desktop-mode-file-tile--missing` modifier the
	 * desktop-files renderer uses.
	 */
	missing?: boolean;
	/**
	 * Visual signal that the viewer doesn't have permission to
	 * open the underlying entity — mirrors the
	 * `desktop-mode-file-tile--access-gated` modifier.
	 */
	accessGated?: boolean;
}

/**
 * Build a tile from a spec by instantiating a `<wpd-tile>` element
 * and reflecting the spec fields onto it as attributes. The
 * component owns the DOM rendering (icon vs thumbnail decision,
 * status ribbon, lock badge, drag-out wiring).
 *
 * Returns the `<wpd-tile>` host so callers can attach event
 * listeners (`click`, `dblclick`, `contextmenu`) directly — those
 * events bubble up from the inner button.
 *
 * @public
 */
export function buildTileFromSpec( spec: TileSpec ): HTMLElement {
	const tile = document.createElement( 'wpd-tile' );

	tile.setAttribute( 'type', spec.type );
	tile.setAttribute( 'ref', spec.ref );
	tile.setAttribute( 'label', spec.label );
	if ( spec.icon ) {
		tile.setAttribute( 'icon', spec.icon );
	}
	if ( spec.favicon ) {
		tile.setAttribute( 'favicon', '' );
	}
	if ( spec.thumbnail ) {
		tile.setAttribute( 'thumbnail', spec.thumbnail );
	}
	if ( spec.role ) {
		tile.setAttribute( 'kind', spec.role );
	}
	if ( spec.status ) {
		tile.setAttribute( 'status', spec.status );
	}
	if ( spec.missing ) {
		tile.setAttribute( 'missing', '' );
	}
	if ( spec.accessGated ) {
		tile.setAttribute( 'access-gated', '' );
	}

	// Host-level data-* attrs (e.g. placementId, folderId, mediaId)
	// so existing selectors / tests can find the tile by id.
	if ( spec.dataset ) {
		for ( const [ key, raw ] of Object.entries( spec.dataset ) ) {
			if ( raw === undefined || raw === null ) {
				continue;
			}
			( tile as HTMLElement ).dataset[ key ] = String( raw );
		}
	}

	// Modifier classes (`__media-tile`, `__tile--user`, etc.) ride
	// on the host so external CSS in `my-wordpress.css` and
	// `desktop-files.css` keeps applying.
	if ( Array.isArray( spec.extraClasses ) ) {
		for ( const c of spec.extraClasses ) {
			if ( c ) {
				tile.classList.add( c );
			}
		}
	}

	// Plugin extension point: tweak the class list before the
	// component paints. `applyFilters` is sync, so the result lands
	// before the first render pass.
	const classFiltered = applyFilters< string, [ TileSpec ] >(
		'desktop-mode.tile.class',
		tile.className,
		spec,
	);
	if ( classFiltered && classFiltered !== tile.className ) {
		tile.className = classFiltered;
	}

	if ( typeof spec.x === 'number' && typeof spec.y === 'number' ) {
		tile.style.position = 'absolute';
		tile.style.left = `${ spec.x }px`;
		tile.style.top = `${ spec.y }px`;
	}

	return tile;
}

/**
 * Drag-out payload — what the drag manager carries when the user
 * lifts a tile and drops it on a desktop-files surface (wallpaper,
 * folder window). The receiving drop target creates a placement
 * with `{ kind, ref }` resolved against the file-type registry.
 *
 * @public
 */
export interface TileDragOutPayload {
	/** File-type slug — `'post'`, `'user'`, `'attachment'`, … */
	kind: string;
	/** Opaque ref — entity id as string. */
	ref: string;
	/** Optional human-readable label for diagnostics + ghost. */
	title?: string;
	/** Optional dashicon class for the ghost. */
	icon?: string;
	/**
	 * Source-side My WordPress entity id (`'posts'`, `'pages'`,
	 * `'users'`, plugin-defined). Forwarded onto `ShortcutDragData
	 * .entityId` so drop targets that need to act on the source
	 * entity (notably the recycle bin's drag-to-trash) can resolve
	 * which REST endpoint the `ref` belongs to.
	 */
	entityId?: string;
	/**
	 * Optional cross-frame bridge payload. When set the shell fans
	 * this into `wp.desktop.dragBridge` while the gesture is live so
	 * iframe receivers (Gutenberg drop-receiver, future Media Library
	 * receiver) can insert a block on `desktop-mode-drop`. See
	 * `ShortcutDragData.bridgePayload`.
	 */
	bridgePayload?: import( '../drag-bridge' ).DragBridgePayload;
}

/**
 * Wire a tile so a primary-button drag emits the standard
 * `'shortcut'` payload via the DragManager. Single source of
 * truth — no builder duplicates this pointerdown dance any more.
 *
 * @public
 *
 * @param tile    Tile element from `buildTileFromSpec`.
 * @param payload What the drop target receives.
 * @param onClick Optional hook fired on a sub-threshold gesture
 *                (pointerdown without a drag). Most My WordPress
 *                builders use it to hide the hover tooltip.
 */
export function attachTileDragOut(
	tile: HTMLElement,
	payload: TileDragOutPayload,
	onClick?: () => void,
): void {
	tile.addEventListener( 'pointerdown', ( e: PointerEvent ) => {
		if ( e.button !== 0 ) {
			return;
		}
		const dragManager = getDragManager();
		if ( ! dragManager ) {
			return;
		}
		const rect = tile.getBoundingClientRect();
		dragManager.start( {
			payload: {
				type: 'shortcut',
				source: tile,
				data: {
					kind: payload.kind,
					ref: payload.ref,
					title: payload.title,
					icon: payload.icon,
					entityId: payload.entityId,
					bridgePayload: payload.bridgePayload,
				} satisfies ShortcutDragData,
				ghost: {
					offsetX: e.clientX - rect.left,
					offsetY: e.clientY - rect.top,
				},
			},
			origin: e,
			onClickOnly: onClick,
		} );
	} );
}
